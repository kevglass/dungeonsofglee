import type { PlayerId, RuneClient } from "rune-sdk"
import { PLAYER_CLASS_DEFS, PlayerClass, PlayerInfo, findActiveHero } from "./player";
import { Actor, copyActor, createActor } from "./actor";
import { blocked, calcMoves, Dungeon, findNextStep, generateDungeon, getActorAt, getActorById, getAllRoomsAt, getChestAt, getDungeonById, getRoomAt, Point, Room } from "./dungeon";
import { createMonsterItemLoot, distanceToHero, findActiveMonsters, getAdjacentHero, standingNextToHero } from "./monsters";
import { debugLog, errorLog } from "./log";
import { Item, ItemType, addItemToInventory as addItemToInventory, createItem, useItem } from "./items";

export const STEP_TIME = 1000 / 3;

export type GameEventType = "damage" | "open" | "step" | "died" | "melee" | "shoot" | "magic" | "heal" | "turnChange" | "stairs" | "goldLoot" | "itemLoot" | "chestOpen" | "useItem";
export type GameMoveType = "move" | "attack" | "open" | "heal" | "shoot" | "magic" | "chest";

export function isTargetedMove(type: GameMoveType): boolean {
  return (type === "attack") || (type === "heal") || (type === "shoot") || (type === "magic");
}

// an event that has happened in the logic that the
// renderer will need 
export interface GameEvent {
  type: GameEventType;
  x: number;
  y: number;
  value: number;
  actorId: number;
  delay: number;
  item?: ItemType;
}

export interface GameState {
  persisted?: Record<PlayerId, Persisted>;
  gold: number;
  items: Item[];
  nextId: number;
  playerOrder: string[];
  deadHeroes: Actor[];
  playerInfo: Record<string, PlayerInfo>;
  whoseTurn: string;
  dungeons: Dungeon[];
  possibleMoves: GameMove[];
  currentActivity?: Activity;
  lastUpdate: number;
  events: GameEvent[];
  evilTurnMax: number;

  // save game stuff
  whoseSave?: string;
  saveDesc?: string;
  time: number;
  saveLevel: number;
}

// an activity taking a place - this is a move
// thats been selected and is causing actors
// to move around etc
export interface Activity {
  dungeonId: number;
  actorId: number;
  startTime: number;
  tx: number;
  ty: number;
}

// a single potential move in the game - 
// move to a location, attach an enemy etc
export interface GameMove {
  x: number;
  y: number;
  sx: number;
  sy: number;
  type: GameMoveType;
  depth: number;
}

export interface SaveGame {
  savedAt: number;
  items: Item[];
  level: number;
  desc: string;
  gold: number;
}

export interface Persisted {
  saves: SaveGame[];
}

// The collection of actions the players can take to effect the game
export type GameActions = {
  setTime: (params: { time: number }) => void;

  // The player selected a character type to play. We then add them to the 
  // world
  setPlayerType: (params: { name: string, type: PlayerClass }) => void;

  selectSave: (params: { saveIndex: number }) => void;

  // The player selected an action/move on a particular tile. Apply
  // it and make it tick over
  makeMove: (params: { x: number, y: number }) => void;
  // The player has chosen to end their turn (it's automatic if they run out of moves).
  // Move to the next person (or monsters) turn
  endTurn: () => void;
  // clear the selected type so it can be reselected
  clearType(): () => void;
  // use an item from the inventory
  useItem(params: { id: number }): () => void;
}

declare global {
  const Rune: RuneClient<GameState, GameActions, Persisted>;
}

function enterDungeonAt(game: GameState, level: number) {
  game.dungeons.push(generateDungeon(game, level));

  for (const pid of game.playerOrder) {
    const info = game.playerInfo[pid];
    if (info) {
      joinGame(game, pid, info.type, info.name);
    }
  }
}

function joinGame(game: GameState, playerId: PlayerId, type: PlayerClass, name: string): void {
  // find a start position for our player based on the start rooms
  const dungeon = game.dungeons[game.dungeons.length - 1];
  const mainStartRoom = dungeon.rooms.find(r => r.start);
  if (mainStartRoom) {
    // consider all the spaces in the start room and if they are
    // free add them to a potential list of starts
    const possibleStarts: Point[] = [];
    const startRooms: Room[] = [];

    // find any heroes in the dungeon already
    const heroes: Actor[] = [];
    game.dungeons.forEach(d => heroes.push(...d.actors.filter(a => a.good)));

    // if there aren't any heroes, just use the main start room
    if (heroes.length === 0) {
      startRooms.push(mainStartRoom);
    } else {
      // otherwise try and place the new hero somewhere near the 
      // existing ones
      for (const hero of heroes) {
        const dungeon = getDungeonById(game, hero.dungeonId);
        if (dungeon) {
          const room = getRoomAt(dungeon, hero.x, hero.y);
          if (room && !startRooms.includes(room)) {
            startRooms.push(room);
          }
        }
      }
    }

    // scan through all the potential start rooms looking for an empty space
    for (const room of startRooms) {
      for (let x = 1; x < room.width - 1; x++) {
        for (let y = 1; y < room.height - 1; y++) {
          if (x === room.width - 2 && y === 1) {
            continue;
          }
          if (!getActorAt(dungeon, room.x + x, room.y + y) && !blocked(dungeon, undefined, room.x + x, room.y + y)) {
            possibleStarts.push({ x: x + room.x, y: y + room.y });
          }
        }
      }
    }

    // if we've found somewhere the player can start create their actor based on the
    // character class they chose and add it to the world. 
    if (possibleStarts.length > 0) {
      const start: Point = possibleStarts[Math.floor(Math.random() * possibleStarts.length)];
      const actor: Actor = createActor(playerId, game, PLAYER_CLASS_DEFS[type], dungeon.id, start.x, start.y);
      game.playerInfo[playerId] = {
        dungeonId: dungeon.id,
        type,
        actorId: actor.id,
        name
      };
      dungeon.actors.push(actor);
    } else {
      errorLog("No Start Positions!");
    }
  }
  // add the player to the player order so they can take a turn
  if (!game.playerOrder.includes(playerId)) {
    game.playerOrder.splice(game.playerOrder.length - 1, 0, playerId);
  }

  // evaluate whose turn it is, because when we add a new player
  // it might immediately be their turn or it might change
  // the moves available 
  const whoseMove = game.playerInfo[game.whoseTurn];
  if (whoseMove && whoseMove.actorId) {
    const actor = getActorById(game, dungeon.id, whoseMove.actorId);
    if (actor) {
      // calculate all the possible moves from this position
      calcMoves(game, actor);
    }
  }
}

function saveGame(playerId: string, dungeonIndex: number, game: GameState): void {
  // check if we're playing some one elses save
  if (game.whoseSave && game.whoseSave !== playerId) {
    return;
  }

  let saveGames = game.persisted?.[playerId]?.saves;
  if (!saveGames && game.persisted) {
    saveGames = [];
    game.persisted[playerId] = { saves: saveGames }
  }

  if (saveGames) {
    if (!saveGames[0]) {
      saveGames[0] = {
        savedAt: game.time + Rune.gameTime(),
        level: 0,
        items: [],
        desc: Object.keys(game.playerInfo).map(id => game.playerInfo[id]?.name ?? "").join(","),
        gold: 0
      }
    }
    saveGames[0].level = dungeonIndex;
    saveGames[0].gold = game.gold;
    saveGames[0].items = JSON.parse(JSON.stringify(game.items));
    saveGames[0].desc = Object.keys(game.playerInfo).map(id => game.playerInfo[id]?.name ?? "").join(",");
  }
}

// Move to the next player's or the monster's turn. This includes
// calculating the new moves available for the turn.
export function nextTurn(game: GameState): void {
  let index = game.playerOrder.indexOf(game.whoseTurn);
  if (index >= game.playerOrder.length - 1) {
    // it was evils turns, start a zero again
    index = 0;
  } else {
    index++;
  }
  game.whoseTurn = game.playerOrder[index];

  if (game.whoseTurn !== "evil") {
    const newActor = getActorById(game, game.playerInfo[game.whoseTurn].dungeonId, game.playerInfo[game.whoseTurn].actorId);
    if (newActor) {
      // dead players don't get to play (so are they really players? deep.)
      if (newActor.health <= 0) {
        nextTurn(game);
        return;
      }

      newActor.moves = newActor.maxMoves;
      newActor.actions = 1;
      if (newActor.magic < newActor.maxMagic) {
        newActor.magic++;
      }
      // calculate all the possible moves from this position
      calcMoves(game, newActor);
    }
  } else {
    game.evilTurnMax = 100;
    for (const dungeon of game.dungeons) {
      dungeon.actors.filter(a => !a.good).forEach(actor => {
        actor.moves = actor.maxMoves;
        actor.actions = 1;
      });
    }
  }
  addGameEvent(game, 0, "turnChange", 0);
}

// Semantic wrapper to help with readability 
export function addGameEvent(game: GameState, actorId: number, event: GameEventType, delay: number, x = 0, y = 0, value = 0, item?: ItemType) {
  game.events.push({
    type: event,
    actorId,
    x, y, value,
    delay,
    item
  });
}

function rollCombat(attacker: Actor, target?: Actor, multiplier?: number): number {
  if (!target) {
    return 0;
  }

  let attack = attacker.attack + attacker.modAttack;
  // if we're a ranged fighter and we're adjacent then half the attack
  if (Math.abs(attacker.x - target.x) + Math.abs(attacker.y - target.y) === 1) {
    attack = Math.ceil(attack / 2);
  } else {
    // in some cases attack is upgraded to account for magic or something 
    if (multiplier) {
      attack *= multiplier;
    }
  }

  let skulls = 0;
  for (let i = 0; i < attack; i++) {
    if ((Math.random() * 6) < 3) {
      skulls++;
    }
  }

  let shields = 0;
  for (let i = 0; i < target.defense + target.modDefense; i++) {
    if ((Math.random() * 6) < (target.good ? 2 : 1)) {
      shields++;
    }
  }

  return Math.max(0, skulls - shields);
}

function startDungeon(game: GameState, actor: Actor, nextDungeon: Dungeon, oldDungeon: Dungeon): Actor {
  const startRoom = nextDungeon.rooms.find(r => r.start);

  // scan through all the potential start rooms looking for an empty space
  if (startRoom) {
    const possibleStarts: Point[] = [];
    for (let x = 1; x < startRoom.width - 1; x++) {
      for (let y = 1; y < startRoom.height - 1; y++) {
        if (x === startRoom.width - 2 && y === 1) {
          continue;
        }
        if (!getActorAt(nextDungeon, startRoom.x + x, startRoom.y + y) && !blocked(nextDungeon, undefined, startRoom.x + x, startRoom.y + y)) {
          possibleStarts.push({ x: x + startRoom.x, y: y + startRoom.y });
        }
      }
    }
    // if we can find a start location then move the actor
    // and update the player record if there is any
    if (possibleStarts.length > 0) {
      const start: Point = possibleStarts[Math.floor(Math.random() * possibleStarts.length)];

      oldDungeon.actors.splice(oldDungeon.actors.indexOf(actor), 1);
      // for some reason Rune doesn't like me trying to reuse the actor object
      // here so we'll take a copy instead
      const newActor: Actor = copyActor(actor);
      newActor.dungeonId = nextDungeon.id;
      newActor.x = start.x;
      newActor.y = start.y;
      newActor.lx = start.x;
      newActor.ly = start.y;
      newActor.lt = 0;
      nextDungeon.actors.push(newActor);

      for (const info of Object.values(game.playerInfo)) {
        if (info.actorId === actor.id) {
          info.dungeonId = nextDungeon.id;
        }
      }

      addGameEvent(game, newActor.id, "stairs", 0, actor.x, actor.y, oldDungeon.id);
      return newActor;
    } else {
      errorLog("No start places in new dungeon");
    }
  } else {
    errorLog("No start room in new dungeon");
  }

  return actor;
}

// kill an actor by generating effects and removing them
// from the game model
function kill(game: GameState, dungeon: Dungeon, target: Actor, extraDelay = 0): void {
  target.health = 0;
  dungeon.actors.splice(dungeon.actors.indexOf(target), 1);
  addGameEvent(game, -1, "died", 400 + extraDelay, target.x, target.y, target.sprite);

  if (target.good) {
    game.deadHeroes.push(target);

    if (!findActiveHero(game)) {
      Rune.gameOver();
    }
  } else {
    // do the loot!
    const item = createMonsterItemLoot(game, target);
    if (item) {
      addItemToInventory(game, item);
      addGameEvent(game, -1, "itemLoot", 400 + extraDelay, target.x, target.y, 0, item.type);
    } else if (target.goldOnKill) {
      const lootGold = Math.floor(Math.random() * (target.goldOnKill.max - target.goldOnKill.min)) + target.goldOnKill.min;

      game.gold += lootGold;
      addGameEvent(game, -1, "goldLoot", 400 + extraDelay, target.x, target.y, lootGold);
    }
  }
}

// Run the currently move - this is called one per logic tick (MOVE_TIME). Apply
// the next step in the path or the actual action at the end
function applyCurrentActivity(game: GameState): boolean {
  if (game.currentActivity) {
    game.lastUpdate = Rune.gameTime();

    const dungeon = getDungeonById(game, game.currentActivity.dungeonId);
    if (dungeon) {
      // find the actor that's taking the action
      let actor = dungeon.actors.find(a => a.id === game.currentActivity?.actorId);
      if (actor) {
        // find the next step in the path/action based on the path find we did earlier
        const nextStep = findNextStep(game, actor, game.currentActivity.tx, game.currentActivity.ty);

        // if it's a move then move the actor to the new position and record the last
        // position they were at some we can lerp between the last and the new for 
        // smooth movement
        if (nextStep && nextStep.type === "move") {
          actor.lx = actor.x;
          actor.ly = actor.y;
          actor.lt = Rune.gameTime();
          actor.x = nextStep.x;
          actor.y = nextStep.y;
          actor.moves--;
          addGameEvent(game, actor.id, "step", 0);
          if (actor.x > actor.lx) {
            actor.facingRight = true;
          }
          if (actor.x < actor.lx) {
            actor.facingRight = false;
          }
        }

        // If its an open then open the door and discover any rooms connected to 
        // make them visible and activate any monsters inside
        if (nextStep && nextStep.type === "open") {
          dungeon.doors.filter(d => d.x === nextStep.x && d.y === nextStep.y).forEach(d => d.open = true);
          getAllRoomsAt(dungeon, nextStep.x, nextStep.y).forEach(r => r.discovered = true);
          addGameEvent(game, actor.id, "open", 0);
        }

        // if we're opening a chest it takes up our action point
        if (nextStep && nextStep.type === "chest") {
          const chest = getChestAt(dungeon, nextStep.x, nextStep.y);
          if (chest) {
            chest.open = true;
            const item = createItem(game, chest.item);
            addItemToInventory(game, item);
            addGameEvent(game, actor.id, "chestOpen", 0);
            addGameEvent(game, actor.id, "itemLoot", 0, nextStep.x, nextStep.y, 0, item.type);
          }
        }

        if (nextStep && nextStep.type === "shoot") {
          actor.actions--;

          const target = getActorAt(dungeon, nextStep.x, nextStep.y);
          if (target) {
            const damage = rollCombat(actor, target);
            addGameEvent(game, actor.id, "shoot", 0, nextStep.x, nextStep.y);
            addGameEvent(game, actor.id, "damage", 300, nextStep.x, nextStep.y, damage);

            target.health -= damage;
            if (target.health <= 0) {
              kill(game, dungeon, target, 300);
            }
          }

          // if we've already moved then engaging in combat
          // uses up the rest
          if (actor.moves < actor.maxMoves) {
            actor.moves = 0;
          }
          calcMoves(game, actor);
        }

        if (nextStep && nextStep.type === "magic") {
          actor.actions--;
          actor.magic -= 3;

          const target = getActorAt(dungeon, nextStep.x, nextStep.y);
          if (target) {
            // magic is powerful, add a multiplier
            const damage = rollCombat(actor, target, 2);
            addGameEvent(game, actor.id, "magic", 0, nextStep.x, nextStep.y);
            addGameEvent(game, actor.id, "damage", 300, nextStep.x, nextStep.y, damage);

            target.health -= damage;
            if (target.health <= 0) {
              kill(game, dungeon, target, 300);
            }
          }

          // if we've already moved then engaging in combat
          // uses up the rest
          if (actor.moves < actor.maxMoves) {
            actor.moves = 0;
          }
          calcMoves(game, actor);
        }

        if (nextStep && nextStep.type === "heal") {
          actor.actions--;
          actor.magic -= 2;

          const target = getActorAt(dungeon, nextStep.x, nextStep.y);
          if (target) {
            target.health += 2;
            if (target.health > target.maxHealth) {
              target.health = target.maxHealth;
            }
            addGameEvent(game, actor.id, "heal", 0, nextStep.x, nextStep.y, 2);
          }

          // if we've already moved then engaging in combat
          // uses up the rest
          if (actor.moves < actor.maxMoves) {
            actor.moves = 0;
          }
          calcMoves(game, actor);
        }

        if (nextStep && nextStep.type === "attack") {
          actor.actions--;

          const target = getActorAt(dungeon, nextStep.x, nextStep.y);
          if (target) {
            const damage = rollCombat(actor, target);
            addGameEvent(game, actor.id, "melee", 0);
            addGameEvent(game, actor.id, "damage", 100, nextStep.x, nextStep.y, damage);

            target.health -= damage;
            if (target.health <= 0) {
              kill(game, dungeon, target);
            }
          }
          // if we've already moved then engaging in combat
          // uses up the rest
          if (actor.moves < actor.maxMoves) {
            actor.moves = 0;
          }
          calcMoves(game, actor);
        }

        // if this was the last step then recalculate the available moves
        // for the current turn holder.
        if (nextStep && nextStep.x === game.currentActivity.tx && nextStep.y === game.currentActivity.ty) {
          // check if the player ended up on the stairs down, if so we need to move to
          // the next dungeon
          const room = getRoomAt(dungeon, actor.x, actor.y);
          if (actor.good && room && room.stairsDown) {
            const sx = room.x + Math.floor(room.width / 2);
            const sy = room.y + Math.floor(room.height / 2);
            if (sx === actor.x && sy === actor.y) {
              const dungeonIndex = dungeon.level + 1;
              // if we're the first one to reach this level, then 
              // generate a new dungeon
              if (!game.dungeons.find(d => d.level === dungeonIndex+1)) {
                game.dungeons.push(generateDungeon(game, dungeonIndex+1));
              }

              if (actor.playerId) {
                // player moved down to the next level so save the game
                console.log("Saving game, level: " + dungeonIndex);
                saveGame(actor.playerId, dungeonIndex, game);
              }

              // move the actor to the next dungeons and update its record
              const nextDungeon = game.dungeons.find(d => d.level === dungeonIndex+1);
              if (nextDungeon) {
                actor = startDungeon(game, actor, nextDungeon, dungeon);
              }
            }
          }

          game.currentActivity = undefined;
          calcMoves(game, actor);
        }
      }
      return true;
    }
  }

  return false;
}

// play the evil characters
function takeEvilTurn(game: GameState): void {
  // if theres no heroes left then don't do anything 
  const heroes: Actor[] = [];
  game.dungeons.forEach(d => heroes.push(...d.actors.filter(a => a.good)));
  if (heroes.length === 0) {
    return;
  }

  // guard condition to prevent locking in any case
  game.evilTurnMax--;
  if (game.evilTurnMax <= 0) {
    nextTurn(game);
    return;
  }

  const allPossible = findActiveMonsters(game).filter(a => {
    const nextToHero = standingNextToHero(game, a);

    return (a.moves > 0 && !nextToHero) ||
      (a.actions > 0 && nextToHero);
  });

  allPossible.sort((a, b) => distanceToHero(game, a.dungeonId, a) - distanceToHero(game, b.dungeonId, b));
  if (allPossible.length > 0) {
    const monster = allPossible[0];
    calcMoves(game, monster);
    if (game.possibleMoves.length > 0) {
      const hero = getAdjacentHero(game, monster.dungeonId, monster);
      if (hero) {
        // close enough for attack
        const attackMove = game.possibleMoves.find(m => m.x === hero.x && m.y === hero.y);
        if (attackMove) {
          game.currentActivity = {
            dungeonId: monster.dungeonId,
            actorId: monster.id,
            tx: attackMove.x,
            ty: attackMove.y,
            startTime: Rune.gameTime()
          }
        }

        monster.actions--;
      } else {
        const bestMove = game.possibleMoves.sort((a, b) => distanceToHero(game, monster.dungeonId, a) - distanceToHero(game, monster.dungeonId, b))[0];

        // no point moving if we don't get closer to the heroes
        if (distanceToHero(game, monster.dungeonId, bestMove) < distanceToHero(game, monster.dungeonId, monster)) {
          game.currentActivity = {
            dungeonId: monster.dungeonId,
            actorId: monster.id,
            tx: bestMove.x,
            ty: bestMove.y,
            startTime: Rune.gameTime()
          }
        } else {
          monster.moves = 0;
          monster.actions = 0;
        }
      }
    } else {
      // no moves possible, clear state
      monster.moves = 0;
      monster.actions = 0;
    }
  } else {
    nextTurn(game);
  }
}

// This is the Rune boostrap - its how the server and the client are synchronized by running
// the same game simulation in all places.
Rune.initLogic({
  minPlayers: 1,
  maxPlayers: 4,
  setup: (allPlayerIds): GameState => {
    // this is the initial game state. In our case we'll just generate a dungeon 
    // and move on
    const initialState: GameState = {
      gold: 0,
      evilTurnMax: 0,
      items: [],
      nextId: 1,
      playerOrder: ["evil"],
      deadHeroes: [],
      whoseTurn: allPlayerIds[0],
      playerInfo: {},
      dungeons: [],
      possibleMoves: [],
      lastUpdate: 0,
      events: [],
      time: 0,
      saveLevel: 0,
    }

    initialState.dungeons.push(generateDungeon(initialState, 1));
    return initialState;
  },
  persistPlayerData: true,
  actions: {
    selectSave: ({ saveIndex }, context) => {
      const saves = context.game.persisted[context.playerId]?.saves;
      if (saves && saves[saveIndex]) {
        context.game.whoseSave = context.playerId;
        context.game.saveDesc = saves[saveIndex].desc;
        context.game.saveLevel = saves[saveIndex].level + 1;

        // move the save to the start since we're going to use
        // it throughout
        const save = saves[saveIndex];
        saves.splice(saves.indexOf(save), 1);
        saves.splice(0, 0, save);
        context.game.gold = save.gold;
        context.game.deadHeroes = [];
        context.game.possibleMoves = [];
        context.game.events = [];
        context.game.items = JSON.parse(JSON.stringify(save.items));
        context.game.dungeons = [];
        enterDungeonAt(context.game, save.level+1);
      }
    },

    setTime: ({ time }, context) => {
      context.game.time = time;
    },

    // The player has selected which class of player they want to play. We need
    // to create an actor in the world of the right type of them at one of the possible
    // start locations for the level. Now it might be better to place them near existing heroes
    // so they don't have to walk all the way to them?
    setPlayerType: ({ name, type }, context) => {

      // For some reason I'm getting this action multiple times when I'm not expecting it - possibly
      // because its fired off a Javascript event listener and someone is tapping twice quickly. This
      // guard prevents us adding people more than once
      if (context.game.playerOrder.includes(context.playerId)) {
        errorLog("Already in: " + context.playerId);
        return;
      }

      if (!context.game.whoseSave) {
        let saves = context.game.persisted[context.playerId]?.saves;
        // brand new game - so create a new save
        const save: SaveGame = {
          savedAt: context.game.time + Rune.gameTime(),
          items: [],
          level: 0,
          desc: Object.keys(context.game.playerInfo).map(id => context.game.playerInfo[id]?.name ?? "").join(","),
          gold: 0
        }
        if (!saves) {
          saves = context.game.persisted[context.playerId].saves = [];
        }

        saves.splice(0, 0, save);
        if (saves.length > 3) {
          saves.splice(3, saves.length - 3);
        }
      }
      joinGame(context.game, context.playerId, type, name);
    },
    // The player has selected a move to make from the calculated moves. Set up
    // the current activity to be played out for that move
    makeMove: ({ x, y }, context) => {
      if (context.game.whoseTurn === context.playerId) {
        const move = context.game.possibleMoves.find(m => m.x === x && m.y === y);
        const time = Rune.gameTime();
        if (move) {
          context.game.currentActivity = {
            dungeonId: context.game.playerInfo[context.playerId].dungeonId,
            actorId: context.game.playerInfo[context.playerId].actorId,
            tx: x,
            ty: y,
            startTime: time
          }
        }
      }
    },
    // Indication that a player would like to end their turn - just move to the next player
    // or the monsters
    endTurn: (params, context) => {
      nextTurn(context.game);
    },
    clearType: (params, context) => {
      context.game.playerOrder.splice(context.game.playerOrder.indexOf(context.playerId), 1);
      delete context.game.playerInfo[context.playerId];
    },
    useItem: ({ id }, context) => {
      const item = context.game.items.find(item => item.id === id);
      if (item) {
        // found item to use
        useItem(context.game, context.playerId, item);
      }
    },
  },
  update: (context) => {
    // clear the events list for this frame. It'd be nice if there was a way to fire
    // events directly from Rune to the client but for now we'll just add events from this
    // frame to a list that the client will process since it's all guaranteed delivery of
    // state changes this will work
    context.game.events = [];

    // clean up old dungeons
    if (context.game.dungeons.length > 2) {
      for (const dungeon of [...context.game.dungeons]) {
        if (!dungeon.actors.find(a => a.good)) {
          context.game.dungeons.splice(context.game.dungeons.indexOf(dungeon), 1);
        }
      }
    }

    // we're running the game at 15 FPS because we want the smooth gameTime() tick, however
    // the logic itself doesn't need to run that quickly (we're only taking a logic step)
    if (Rune.gameTime() - context.game.lastUpdate > STEP_TIME) {
      if (!applyCurrentActivity(context.game)) {
        if (context.game.whoseTurn === "evil") {
          // run evil game updates
          takeEvilTurn(context.game);
        } else {
          // no current activity to apply on a player turn, consider moving the turn
          // over automatically if no moves remaining - this is to stream line play
          if (context.game.possibleMoves.length === 0) {
            if (context.game.playerOrder.length > 0) {
              nextTurn(context.game);
            }
          }
        }
      }
    }
  },
  // the number of updates to run a second. I'd like to have this much lower but 
  // Rune.gameTime() runs in these intervals - so if you want to drive your movement
  // for instance from Rune.gameTime() to synchronize movements you need to have
  // this reasonable high to get a smooth tick.
  updatesPerSecond: 15,
  reactive: false,
  events: {
    // called when a new player joins the game - this is part of the Rune 
    // framework. Gotcha here - this isn't called for players that are part
    // of the game when it starts. Initial players are presented in the 
    // allPlayerIds list in setup()
    playerJoined: (playerId) => {
      debugLog("Player Joined: " + playerId);
    },
    // called when a player leaves the game session - this is part of the
    // Rune framework
    playerLeft: (playerId, context) => {
      // when a player leaves we need to check if it was their turn. If it was
      // we need to move the turn on so we don't get stuck in a place where the game
      // can't progress.
      const playerInfo = context.game.playerInfo[playerId];
      if (playerInfo) {
        if (context.game.whoseTurn === playerId) {
          nextTurn(context.game);
        }
        const dungeon = getDungeonById(context.game, playerInfo.dungeonId);
        if (dungeon) {
          // also need to clear up their state and actor from the game 
          context.game.playerOrder.splice(context.game.playerOrder.indexOf(playerId), 1);
          dungeon.actors = dungeon.actors.filter(a => a.id !== playerInfo.actorId);
        }
        delete context.game.playerInfo[playerId];
      }
    },

  }
})
