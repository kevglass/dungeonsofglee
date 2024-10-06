import tiles from "./assets/tiles-64.png";
import cokeandcodeUrl from "./assets/cokeandcode.png";
import logoUrl from "./assets/logo.png";
import sfxDoorUrl from "./assets/opendoor.mp3";
import sfxStepUrl from "./assets/mapstep.mp3";
import sfxStepsUrl from "./assets/steps.mp3";
import sfxSwishUrl from "./assets/swish.mp3";
import sfxPainUrl from "./assets/pain1.mp3";
import sfxMonsterUrl from "./assets/monster1.mp3";
import sfxYourTurnUrl from "./assets/yourturn.mp3";
import sfxRangedUrl from "./assets/arrow.mp3";
import sfxMagicUrl from "./assets/fireball.mp3";
import sfxHealUrl from "./assets/heal.mp3";
import sfxClickUrl from "./assets/click.mp3";
import sfxGlugUrl from "./assets/glug.mp3";
import sfxAbilityUrl from "./assets/ability.mp3";

import { GameActions, GameEvent, GameState, Persisted, STEP_TIME, isTargetedMove } from "./logic";
import { Actor } from "./actor";
import { getActorAt, getActorById, getChestAt, getDoorAt, getDungeonById, getRoomAt, getWallAt } from "./dungeon";
import { PLAYER_CLASS_DEFS, PlayerClass, PlayerInfo } from "./player";
import { InputEventListener, TileSet, centerText, drawImage, drawRect, drawText, drawTile, fillCircle, fillRect, loadTileSet, popState, pushState, registerInputEventListener, rotate, scale, screenHeight, screenWidth, setAlpha, stringWidth, translate, updateGraphics } from "./renderer/graphics";
import { intersects } from "./renderer/util";
import { Sound, loadSound, playSound } from "./renderer/sound";
import { errorLog } from "./log";
import { ItemInfo, getItemInfo } from "./items";
import { OnChangeParams } from "rune-sdk";

/**
 * Dungeons of Glee
 * 
 * A very simple dungeon crawler game to try out the Rune SDK (https://rune.ai). I wanted to give it 
 * a go so this is a very quick hack of a dungeon game to see what its all about.
 */

// tileset references to the different wall tops and sides to be displayed - the duplicated
// values are to increase the probability of that type of tile.
const WALL_TOPS = [92, 92, 92, 92, 92, 92, 93, 94, 95];
const WALL_FRONTS = [100, 100, 100, 100, 100, 100, 101, 102, 103];
const PROJECTILE_TIME = 250;
const GOLD_FLY_TIME = 500;
const ITEM_FLY_TIME = 500;

// Palette taken from sprites
const GREEN = "#436c15"; // movement
const RED = "#cc3a3a"; // health
const BLUE = "#2d7de9"; // magic
const GOLD = "#ffb866"; // looted gold

// Definition of the type of character the player can choose
interface PlayerClassDef {
    sprite: number;
    name: string;
    type: PlayerClass;
}

// a floating damage/heal marker
interface Marker {
    x: number;
    y: number;
    value: number;
    created: number;
    source?: Actor;
    type: string;
    delay: number;
}

// a sprite that flies from one map location to another
interface Projectile {
    sx: number;
    sy: number;
    dx: number;
    dy: number;
    sprite: number;
    created: number;
}

// The actual game running ont he client
export class DungeonsOfGlee implements InputEventListener {
    // the main set of graphics we're using for everything
    tiles: TileSet;
    // the images loaded for the player's avatars
    playerAvatars: Record<string, HTMLImageElement> = {};

    // state maintained between clients
    game?: GameState;
    state?: OnChangeParams<GameState, GameActions, Persisted>;
    localPlayerId?: string;

    // an animation ticker
    anim = 0;

    // the offset for the camera view of the world
    offsetx = 0;
    offsety = 0;

    // the size we're rendering the dungeon tiles at
    tileSize = 48;
    // true if we're in the middle of completing a move
    moving = false;

    // the list of player characters that can be used
    classes: PlayerClassDef[] = [
        { sprite: 0, name: "Dwarf", type: "dwarf" },
        { sprite: 1, name: "Witch", type: "witch" },
        { sprite: 2, name: "Elf", type: "elf" },
        { sprite: 3, name: "Knight", type: "knight" },
    ];

    markers: Marker[] = [];
    projectiles: Projectile[] = [];

    // sound effect for door opening
    sfxDoor: Sound;
    // sound effect for taking a step
    sfxStep: Sound;
    // sound effect for taking a swishing sword
    sfxSwish: Sound;
    // sound effect hero taking damage
    sfxPain: Sound;
    // sound effect monster taking damage
    sfxMonster: Sound;
    // sound effect monster taking damage
    sfxTurn: Sound;
    // sound effect button click
    sfxClick: Sound;
    // sound effect for healing spell
    sfxHeal: Sound;
    // sound effect for magic attack
    sfxMagic: Sound;
    // sound effect ranged attack
    sfxRanged: Sound;
    // sound effect for going down stairs
    sfxStairs: Sound;
    // sounds for items
    sfxItems: Record<string, Sound> = {}

    logo: HTMLImageElement;
    cokeandcode: HTMLImageElement;
    paused = false;

    // true if we're testing locally, lets me pause the game for screenshots
    // etc
    devMode: boolean = window.location.hostname === "localhost";

    // we use the stairs event to allow us to display the old dungeon for a bit 
    // and the old location while we fade out
    stairsEvent?: GameEvent;
    stairsFade = 0;
    stairsFadingOut = true;

    // used to do the effect of gold flying into your bag
    goldFlyEvent?: GameEvent;
    goldFlyStart = 0;

    // used to do the effect of item flying into your bag
    itemFlyEvent?: GameEvent;
    itemFlyStart = 0;

    // true if we're looking at the loot screen
    lootOpen = false;

    selectedItemIndex = -1;

    showSaveGameScreen = false;

    inited = false;

    constructor() {
        // register ourselves as the input listener so
        // we get nofified of mouse presses
        registerInputEventListener(this);

        // load all the resources. note that all of these
        // are async - so we may end up with empty images/sounds
        // for a while
        this.tiles = loadTileSet(tiles, 64, 64);
        this.sfxDoor = loadSound(sfxDoorUrl);
        this.sfxStep = loadSound(sfxStepUrl);
        this.sfxSwish = loadSound(sfxSwishUrl);
        this.sfxPain = loadSound(sfxPainUrl);
        this.sfxMonster = loadSound(sfxMonsterUrl);
        this.sfxTurn = loadSound(sfxYourTurnUrl);
        this.sfxClick = loadSound(sfxClickUrl);
        this.sfxHeal = loadSound(sfxHealUrl);
        this.sfxMagic = loadSound(sfxMagicUrl);
        this.sfxRanged = loadSound(sfxRangedUrl);
        this.sfxStairs = loadSound(sfxStepsUrl);

        this.sfxItems['glug'] = loadSound(sfxGlugUrl);
        this.sfxItems['weapon'] = loadSound(sfxAbilityUrl);

        this.logo = new Image();
        this.logo.src = logoUrl;
        this.cokeandcode = new Image();
        this.cokeandcode.src = cokeandcodeUrl;
    }

    // get the icon to use for a given player class
    iconForClass(type: PlayerClass): number {
        const def = this.classes.find(d => d.type === type);
        if (def) {
            return def.sprite;
        }

        return 0;
    }

    // get the local player's character class
    get localPlayerClass(): PlayerClass | undefined {
        return this.game?.playerInfo[this.localPlayerId ?? ""]?.type;
    }

    // get the local player's player information if its been set
    get myPlayerInfo(): PlayerInfo | undefined {
        return this.game?.playerInfo[this.localPlayerId ?? ""];
    }

    // check if it's this player's turn
    get myTurn(): boolean {
        return this.game?.whoseTurn === this.localPlayerId;
    }

    // get the actor that represents this player
    get myActor(): Actor | undefined {
        if (this.myPlayerInfo && this.game) {
            return getActorById(this.game, this.myPlayerInfo.dungeonId, this.myPlayerInfo.actorId);
        }

        if (this.game) {
            const playerInfo = this.game.playerInfo[this.game.whoseTurn];
            if (playerInfo) {
                return getActorById(this.game, playerInfo.dungeonId, playerInfo.actorId);
            }
        }

        return undefined;
    }

    get isDead(): boolean {
        if (!this.myActor) {
            return false;
        }

        return this.myActor.health <= 0;
    }

    // notification that the mouse has been pressed
    mouseUp(x: number, y: number, button: number): void {
        if (button !== 0 && this.devMode) {
            this.paused = !this.paused;
            if (!this.paused) {
                requestAnimationFrame(() => { this.loop() });
            }
            return;
        }

        playSound(this.sfxClick);
        if (this.showSaveGameScreen) {
            const selected = Math.floor((y - 75) / 100);
            if (selected >= 0 && selected < 3) {
                Rune.actions.selectSave({ saveIndex: selected });
                this.showSaveGameScreen = false;    
            } else {
                this.showSaveGameScreen = false;    
            }
            return;
        }

        // if we haven't seleccted a class yet then using the y mouse position
        // determine which class the player selected
        if (!this.localPlayerClass) {
            const selected = Math.floor((y - 180) / 70);
            if (this.classes[selected]) {
                Rune.actions.setPlayerType({ name: Rune.getPlayerInfo(this.localPlayerId ?? "").displayName, type: this.classes[selected].type });
            }
            if (selected === 4) {
                this.showSaveGameScreen = true;
            }
        } else {
            if (this.isDead) {
                Rune.actions.clearType();
                return;
            }

            if (x > screenWidth() - 64 && y < 64) {
                this.lootOpen = !this.lootOpen;
                this.selectedItemIndex = -1;
                return;
            }

            if (this.lootOpen) {
                // do the loot UI mouse controls
                const tx = Math.floor((x - (Math.floor(screenWidth() / 2) - 134)) / 68);
                const ty = Math.floor((y - 100) / 68);
                if (tx >= 0 && ty >= 0 && tx < 4 && ty < 3) {
                    this.selectedItemIndex = tx + (ty * 4);
                }

                if (this.game && this.myTurn) {
                    // clicking the use area
                    if (intersects(x, y, Math.floor(screenWidth() / 2) - 84, 380, 172, 30)) {
                        const selectedItem = this.game.items[this.selectedItemIndex];
                        if (selectedItem && this.myPlayerInfo) {
                            const info: ItemInfo = getItemInfo(selectedItem.type);
                            if (!info.onlyUsedBy || info.onlyUsedBy.includes(this.myPlayerInfo.type)) {
                                // use the item
                                Rune.actions.useItem({ id: selectedItem.id });
                            }
                        }

                        return;
                    }
                }

                if (y > 400) {
                    this.lootOpen = false;
                }
                return;
            }

            // otherwise we're in game. Work out which tile the player 
            // clicked based on the camera offset.
            const tx = Math.floor((x - this.offsetx) / this.tileSize);
            const ty = Math.floor((y - this.offsety) / this.tileSize);

            if ((y < screenHeight() - 100) && (y > 64)) {
                // if we're in game and theres a possible move at the location then
                // run the Rune action to play a move.
                if (this.game && !this.game.currentActivity && this.myActor) {
                    const dungeon = getDungeonById(this.game, this.myActor.dungeonId);
                    if (!dungeon) {
                        return;
                    }
                    const move = this.game.possibleMoves.find(m => m.x === tx && m.y === ty);
                    const actor = getActorAt(dungeon, tx, ty);
                    if (move && (!actor || isTargetedMove(move.type))) {
                        Rune.actions.makeMove({ x: tx, y: ty });
                    }
                }
            }

            // if we're clicking on the end turn button apply that Rune action.
            if (intersects(x, y, screenWidth() - 112, screenHeight() - 109, 114, 47)) {
                // pressed end turn
                if (this.myTurn) {
                    Rune.actions.endTurn();
                }
            }
        }
    }

    // start the game. This is a simple boostrap to start Rune's client
    // and beging the rendering loop
    start(): void {
        Rune.initClient({
            onChange: (game) => {
                if (!this.inited) {
                    this.inited = true;
                    setTimeout(() => {
                        Rune.actions.setTime({ time: Date.now() });
                    }, 0)
                }
                this.gameUpdate(game);
            },
        });

        requestAnimationFrame(() => { this.loop() });
    }

    // Callback from Rune when the game state has changed
    gameUpdate(state: OnChangeParams<GameState, GameActions, Persisted>) {
        // record our player ID
        this.localPlayerId = state.yourPlayerId;

        // update our game state
        this.game = state.game;
        this.state = state;

        // load any player avatars we don't already have
        for (const playerId in state.players) {
            if (!this.playerAvatars[playerId]) {
                this.playerAvatars[playerId] = new Image();
                this.playerAvatars[playerId].src = state.players[playerId].avatarUrl;
            }
        }

        // handle any events that were recorded this game frame
        for (const event of state.game.events) {
            this.processEvent(event);
        }
    }

    playSound(sound: Sound): void {
        if (this.myActor) {
            playSound(sound);
        }
    }

    // process game events presented by the game state
    processEvent(event: GameEvent) {
        if (event.type === "open") {
            this.playSound(this.sfxDoor);
        }
        if (event.type === "chestOpen") {
            this.playSound(this.sfxDoor);
        }
        if (event.type === "step") {
            // delayed so the sound plays when we reach our destination
            setTimeout(() => {
                this.playSound(this.sfxStep);
            }, STEP_TIME);
        }
        if (event.type === "melee") {
            this.playSound(this.sfxSwish);
        }
        if (event.type === "turnChange") {
            if (this.myTurn) {
                this.playSound(this.sfxTurn);
            }
        }
        if (event.type === "shoot") {
            if (this.game && this.myActor) {
                this.playSound(this.sfxRanged);
                const attacker = getActorById(this.game, this.myActor?.dungeonId, event.actorId);
                if (attacker) {
                    // create a projectile to send for the arrow
                    this.projectiles.push({
                        sx: attacker.x,
                        sy: attacker.y,
                        dx: event.x,
                        dy: event.y,
                        created: Date.now(),
                        sprite: 40
                    });
                }
            }
        }
        if (event.type === "useItem") {
            if (event.item) {
                const info = getItemInfo(event.item);
                if (info && info.sound && this.sfxItems[info.sound]) {
                    this.playSound(this.sfxItems[info.sound]);
                }
            }
        }
        if (event.type === "magic") {
            if (this.game && this.myActor) {
                this.playSound(this.sfxMagic);
                const attacker = getActorById(this.game, this.myActor?.dungeonId, event.actorId);
                if (attacker) {
                    // create a projectile to send for the fireball
                    this.projectiles.push({
                        sx: attacker.x,
                        sy: attacker.y,
                        dx: event.x,
                        dy: event.y,
                        created: Date.now(),
                        sprite: 37
                    });
                }
            }
        }
        if (event.type === "heal") {
            if (this.game && this.myActor) {
                this.playSound(this.sfxHeal);
                const healer = getActorById(this.game, this.myActor?.dungeonId, event.actorId);
                if (healer) {
                    // create a projectile to send for the heal effect
                    this.projectiles.push({
                        sx: healer.x,
                        sy: healer.y,
                        dx: event.x,
                        dy: event.y,
                        created: Date.now(),
                        sprite: 38
                    });
                    // schedule a marker to show the effect of the heal
                    this.markers.push({
                        x: event.x, y: event.y, value: event.value, created: Date.now(),
                        source: healer,
                        type: "heal",
                        delay: 200
                    });
                }
            }
        }
        if (event.type === "damage") {
            if (this.game && this.myActor) {
                const attacker = getActorById(this.game, this.myActor?.dungeonId, event.actorId);
                if (event.value > 0 && attacker) {
                    if (attacker.good) {
                        this.playSound(this.sfxMonster);
                    } else if (!attacker.good) {
                        this.playSound(this.sfxPain);
                    }
                }
                // show the damage marker
                this.markers.push({
                    x: event.x, y: event.y, value: event.value, created: Date.now(),
                    source: attacker,
                    type: "damage",
                    delay: event.delay
                });
            }
        }
        if (event.type === "died") {
            if (this.game && this.myActor) {
                // add a special marker that causes a spinning actor to be displayed 
                // which fades out for death cycle
                this.markers.push({
                    x: event.x, y: event.y, value: event.value, created: Date.now(),
                    source: getActorById(this.game, this.myActor?.dungeonId, event.actorId),
                    type: "died",
                    delay: event.delay
                });
            }
        }
        // we're going down the stairs so start the fade in / out
        if (event.type === "stairs" && event.actorId === this.myActor?.id) {
            this.playSound(this.sfxStairs);
            this.stairsEvent = event;
            this.stairsFade = 0;
            this.stairsFadingOut = true;
        }
        // we've got gold do the fly through
        if (event.type === "goldLoot") {
            this.goldFlyEvent = event;
            this.goldFlyStart = Date.now() + event.delay;
        }
        // we've got an item do the fly through
        if (event.type === "itemLoot") {
            this.itemFlyEvent = event;
            this.itemFlyStart = Date.now() + event.delay;
        }
    }

    // the main client side game rendering loop. 
    loop(): void {
        // let the graphics do whatever it wants to do
        updateGraphics();

        // clear the screen
        fillRect(0, 0, screenWidth(), screenHeight(), "rgb(20,20,20)");

        const cx = Math.floor(screenWidth() / 2);

        // filter any expired markers (they hang around for a second)
        this.markers = this.markers.filter(m => Date.now() - (m.created + m.delay) < 1000);
        this.projectiles = this.projectiles.filter(m => Date.now() - (m.created) < PROJECTILE_TIME);

        // if we have game state
        if (this.game) {
            this.anim++;
            // if we don't currently have a player class then show
            // the class selection screen
            if (!this.localPlayerClass && this.localPlayerId) {
                if (this.showSaveGameScreen) {
                    let p = 0;
                    for (const save of this.game.persisted?.[this.localPlayerId]?.saves ?? []) {
                        let desc = save.desc.replace(Rune.getPlayerInfo(this.localPlayerId).displayName, "");
                        if (desc.startsWith(",")) {
                            desc = desc.substring(1);
                        }
                        fillRect(cx - 150, 80 + (p * 100), 300, 95, "rgb(40,40,40)");
                        drawTile(this.tiles, cx + 80, 75 + (p * 100), 60, 64, 64);
                        drawText(cx - 140, 108 + (p * 100), "Level " + (save.level+1), 24, "white");

                        drawText(cx - 140, 126 + (p * 100), "Items: " + (save.items.length), 14, "white");

                        if (desc.length > 0) {
                            drawText(cx - 140, 150 + (p * 100), "Played " + Math.floor((Date.now() - save.savedAt) / (1000 * 60 * 60 * 24)) + " days ago with:", 14, "white");
                            drawText(cx - 140, 166 + (p * 100), desc, 14, "white");
                        } else {
                            drawText(cx - 140, 150 + (p * 100), "Played " + Math.floor((Date.now() - save.savedAt) / (1000 * 60 * 60 * 24)) + " days ago, solo.", 14, "white");
                        }
                        p++;
                    }
                    p = 4;
                    fillRect(cx - 90, 190 + (p * 70), 180, 64, "rgb(40,40,40)");
                    drawTile(this.tiles, cx - 80, 190 + (p * 70), 77, 64, 64);
                    drawText(cx - 10, 230 + (p * 70), "Back", 24, "white");
                } else {
                    drawImage(this.logo, Math.floor((screenWidth() / 2) - (this.logo.width / 2)), 10, this.logo.width, this.logo.height);
                    centerText("Select Your Hero", 20, 160, "white");
                    let p = 0;
                    for (const clazz of this.classes) {
                        fillRect(cx - 90, 180 + (p * 70), 180, 64, "rgb(40,40,40)");
                        drawTile(this.tiles, cx - 80, 180 + (p * 70), clazz.sprite, 64, 64);
                        drawText(cx - 10, 220 + (p * 70), clazz.name, 24, "white");
                        p++;
                    }

                    if (this.game.whoseSave) {
                        const name = Rune.getPlayerInfo(this.game.whoseSave).displayName;
                        centerText(name, 16, 210 + (p*70), "white");
                        centerText("selected a level " + this.game.saveLevel + " start!", 16, 230 + (p*70), "white");
                    } else {
                        if (this.game.persisted?.[this.localPlayerId]?.saves?.length ?? 0 > 0) {
                            fillRect(cx - 90, 190 + (p * 70), 180, 64, "rgb(40,40,40)");
                            drawTile(this.tiles, cx - 80, 190 + (p * 70), 60, 64, 64);
                            drawText(cx - 10, 230 + (p * 70), "Load", 24, "white");
                        }
                    }
                }
            } else {
                // otherwise render the dungeon area since we're in 
                // game
                pushState();
                this.renderDungeon();
                popState();

                // do the nice little fade effect between levels
                if (this.stairsEvent || !this.stairsFadingOut) {
                    setAlpha(this.stairsFade);
                    fillRect(0, 0, screenWidth(), screenHeight(), "black");
                    setAlpha(1);

                    if (this.stairsFadingOut) {
                        this.stairsFade += 0.02;
                        if (this.stairsFade >= 1) {
                            this.stairsFade = 1;
                            this.stairsFadingOut = false;
                            this.stairsEvent = undefined;
                        }
                    } else {
                        this.stairsFade -= 0.02;
                        if (this.stairsFade <= 0) {
                            this.stairsFade = 0;
                            this.stairsFadingOut = true;
                        }
                    }
                }
            }

            // render the bar of players at the top of the screen
            if (this.myActor) {
                let p = 0;
                for (const playerId of this.game.playerOrder) {
                    if (playerId === "evil") {
                        continue;
                    }
                    fillRect((p * 68), 0, 64, 64, "rgb(40,40,40)");
                    if (this.game.playerInfo[playerId]) {
                        const actor = getActorById(this.game, this.game.playerInfo[playerId].dungeonId, this.game.playerInfo[playerId].actorId);
                        if (actor) {
                            const sprite = actor.health > 0 ? actor.sprite : 10;
                            drawTile(this.tiles, (p * 68) + 3, 0, sprite, 64, 64);
                            for (let i = 0; i < actor.health; i++) {
                                fillRect((p * 68) + 4, 52 - (i * 9), 8, 8, RED);
                                drawRect((p * 68) + 4, 52 - (i * 9), 8, 8, "black");
                            }
                        }
                    } else {
                        drawText((p * 68) + 24, 43, "?", 32, "white");
                    }
                    drawImage(this.playerAvatars[playerId], (p * 68) + 40, 4, 20, 20);

                    if (this.game.whoseTurn === playerId) {
                        drawRect((p * 68), 0, 64, 64, "yellow");
                    }
                    p++;
                }

                const dungeon = getDungeonById(this.game, this.stairsEvent ? this.stairsEvent.value : this.myActor.dungeonId);
                if (dungeon) {
                    fillRect(0, 66, screenWidth(), 27, "rgba(0.4,0.4,0.4,0.5)");
                    drawText(10, 87, "LEVEL " + dungeon.level, 20, "white");

                    if (this.devMode) {
                        drawText(10, 107, this.game.playerOrder.join(","), 20, "white");
                        drawText(10, 127, "Current: " + this.game.whoseTurn, 20, "white");
                    }

                    drawTile(this.tiles, screenWidth() - 50, 47, 39);
                    // dirty hack - if there is gold flying don't show it as part of the gold in the game
                    // state. We don't want the gold to appear in our total until we've completed our turn
                    const goldStr = "" + (this.goldFlyEvent ? this.game.gold - this.goldFlyEvent.value : this.game.gold);
                    drawText(screenWidth() - stringWidth(goldStr, 20) - 35, 87, goldStr, 20, GOLD);
                }

                // render the loot box
                fillRect(screenWidth() - 64, 0, 64, 64, "rgb(40,40,40)");
                drawTile(this.tiles, screenWidth() - 64, 0, this.lootOpen ? 66 : 74);
            }

            // render the status bar at the bottom
            if (this.localPlayerClass) {
                fillRect(0, screenHeight() - 100, screenWidth(), 100, "rgb(40,40,40)");
                fillRect(0, screenHeight() - 70, screenWidth(), 70, "rgb(60,60,60)");

                if (this.isDead) {
                    fillRect(0, 100, screenWidth(), 27, "#444");
                    centerText("YOU HAVE DIED", 20, 122, "white");
                }
                if (this.game.whoseTurn === this.localPlayerId) {
                    fillRect(0, screenHeight() - 100, screenWidth(), 27, "#8ac34d");
                    drawText(10, screenHeight() - 80, "YOUR TURN", 20, "white");

                    // end turn button
                    fillRect(screenWidth() - 122, screenHeight() - 109, 114, 47, "rgb(40,40,40)");
                    fillRect(screenWidth() - 122, screenHeight() - 109, 114, 44, "#8ac34d");
                    fillRect(screenWidth() - 119, screenHeight() - 106, 108, 38, "rgb(40,40,40)");
                    drawText(screenWidth() - 111, screenHeight() - 81, "END TURN", 18, "white");
                } else {
                    fillRect(0, screenHeight() - 100, screenWidth(), 27, RED);

                    const playerTurn = this.state?.players[this.game.whoseTurn];
                    if (playerTurn) {
                        centerText(playerTurn.displayName.toUpperCase() + "'S TURN", 20, screenHeight() - 80, "white");
                    } else {
                        centerText("MONSTER'S TURN", 20, screenHeight() - 80, "white");
                    }
                }

                if (this.myActor) {
                    drawTile(this.tiles, cx - 150, screenHeight() - 65, 70, 24, 24);
                    for (let i = 0; i < this.myActor?.health; i++) {
                        fillRect(cx - 150 + 30 + (i * 20), screenHeight() - 60, 15, 15, RED);
                        drawRect(cx - 150 + 30 + (i * 20), screenHeight() - 60, 15, 15, "black");
                    }

                    drawTile(this.tiles, cx - 155, screenHeight() - 40, 75, 32, 32);
                    for (let i = 0; i < this.myActor?.magic; i++) {
                        fillRect(cx - 150 + 30 + (i * 20), screenHeight() - 30, 15, 15, BLUE);
                        drawRect(cx - 150 + 30 + (i * 20), screenHeight() - 30, 15, 15, "black");
                    }

                    drawTile(this.tiles, cx + 10, screenHeight() - 65, 77, 24, 24);
                    for (let i = 0; i < this.myActor?.moves; i++) {
                        fillRect(cx + 10 + 30 + (i * 20), screenHeight() - 60, 15, 15, GREEN);
                        drawRect(cx + 10 + 30 + (i * 20), screenHeight() - 60, 15, 15, "black");
                    }
                    drawTile(this.tiles, cx + 20, screenHeight() - 38, 45, 28, 28);
                    drawText(cx + 50, screenHeight() - 18, "" + this.myActor.attack, 24, "white");
                    if (this.myActor.modAttack) {
                        fillCircle(cx + 73, screenHeight() - 17, 12, GREEN);
                        const str = "+" + this.myActor.modAttack;
                        drawText(cx + 72 - Math.floor(stringWidth(str, 14) / 2), screenHeight() - 12, str, 14, "white");
                    }

                    drawTile(this.tiles, cx + 90, screenHeight() - 38, 69, 28, 28);
                    drawText(cx + 120, screenHeight() - 16, "" + this.myActor.defense, 24, "white");
                    if (this.myActor.modDefense) {
                        fillCircle(cx + 143, screenHeight() - 17, 12, GREEN);
                        const str = "+" + this.myActor.modDefense;
                        drawText(cx + 142 - Math.floor(stringWidth(str, 14) / 2), screenHeight() - 12, str, 14, "white");
                    }
                } else {
                    errorLog("No local actor found");
                }

                // if we've just looted gold draw it flying to 
                // the gold store
                if (this.goldFlyEvent) {
                    // find the screen coordinates of the death that happened
                    const xp = (this.goldFlyEvent.x * this.tileSize) + this.offsetx;
                    const yp = (this.goldFlyEvent.y * this.tileSize) + this.offsety;
                    const bagx = screenWidth() - 50;
                    const bagy = 60;
                    const dx = bagx - xp;
                    const dy = bagy - yp;
                    const delta = (Date.now() - this.goldFlyStart) / GOLD_FLY_TIME;
                    if (delta < 1) {
                        if (delta > 0) {
                            // gold is flying
                            const x = xp + (dx * delta);
                            const y = yp + (dy * delta);
                            drawTile(this.tiles, x, y, 39, this.tileSize, this.tileSize);
                        }
                    } else {
                        // we're done
                        this.goldFlyEvent = undefined;
                    }
                }

                // if we've just looted gold draw it flying to 
                // the gold store
                if (this.itemFlyEvent && this.itemFlyEvent.item) {
                    // find the screen coordinates of the death that happened
                    const xp = (this.itemFlyEvent.x * this.tileSize) + this.offsetx;
                    const yp = (this.itemFlyEvent.y * this.tileSize) + this.offsety;
                    const boxx = screenWidth() - 50;
                    const boxy = 30;
                    const dx = boxx - xp;
                    const dy = boxy - yp;
                    const delta = (Date.now() - this.itemFlyStart) / ITEM_FLY_TIME;
                    if (delta < 1) {
                        if (delta > 0) {
                            // gold is flying
                            const x = xp + (dx * delta);
                            const y = yp + (dy * delta);
                            drawTile(this.tiles, x, y, getItemInfo(this.itemFlyEvent.item).icon, this.tileSize, this.tileSize);
                        }
                    } else {
                        // we're done
                        this.goldFlyEvent = undefined;
                    }
                }

                // render the inventory if open
                if (this.lootOpen) {
                    pushState();
                    translate(Math.floor(screenWidth() / 2) - 134, 100);
                    fillRect(0, 0, 272, 272 + 50, "rgb(40,40,40)");
                    for (let y = 0; y < 3; y++) {
                        for (let x = 0; x < 4; x++) {
                            fillRect(2 + (x * 68), 2 + (y * 68), 64, 64, "rgba(0,0,0,0.5)");
                            const index = x + (y * 4);
                            const item = this.game.items[index];
                            if (item) {
                                drawTile(this.tiles, 2 + (x * 68), 2 + (y * 68), getItemInfo(item.type).icon);
                                const countStr = "" + item.count;
                                drawText(2 + (x * 68) + 60 - stringWidth(countStr, 14), 2 + (y * 68) + 60, countStr, 14, "white");
                                if (this.selectedItemIndex === index) {
                                    drawRect(2 + (x * 68), 2 + (y * 68), 64, 64, GOLD);
                                }
                            }
                        }
                    }

                    popState();

                    const selectedItem = this.game.items[this.selectedItemIndex];
                    if (selectedItem) {
                        centerText(getItemInfo(selectedItem.type).name, 20, 335, "white");
                        centerText("(" + getItemInfo(selectedItem.type).desc + ")", 14, 360, "white");
                    }
                    if (!this.myTurn) {
                        centerText("NOT YOUR TURN", 20, 402, "white");
                    } else {
                        if (selectedItem && this.myPlayerInfo) {
                            const info: ItemInfo = getItemInfo(selectedItem.type);
                            if (info.onlyUsedBy && !info.onlyUsedBy.includes(this.myPlayerInfo.type)) {
                                drawText(Math.floor(screenWidth() / 2) - 50, 402, "ONLY", 20, "white");
                                for (const type of info.onlyUsedBy) {
                                    drawTile(this.tiles, Math.floor(screenWidth() / 2) + 10, 372, PLAYER_CLASS_DEFS[type].sprite, 48, 48);
                                }
                            } else {
                                fillRect(Math.floor(screenWidth() / 2) - 84, 380, 172, 30, "rgb(60,60,60)")
                                centerText("USE", 20, 402, "white");
                            }
                        }
                    }
                }
            }
        }


        // request another loop from the
        if (!this.paused) {
            requestAnimationFrame(() => { this.loop() });
        }
    }

    // render the options/moves available to the player. These are shown 
    // as semi-transparent markers over the top fo the dungeon
    renderOptions(): void {
        if (this.game && this.myActor) {
            const dungeon = getDungeonById(this.game, this.stairsEvent ? this.stairsEvent.value : this.myActor.dungeonId);
            if (!dungeon) {
                return;
            }
            setAlpha(0.5);
            for (const option of this.game.possibleMoves) {
                if (option.type === "move") {
                    if (!getActorAt(dungeon, option.x, option.y)) {
                        drawTile(this.tiles, (option.x * this.tileSize), (option.y * this.tileSize), 5, this.tileSize, this.tileSize);
                    }
                }
                if (option.type === "open") {
                    drawTile(this.tiles, (option.x * this.tileSize), (option.y * this.tileSize), 6, this.tileSize, this.tileSize);
                }
                if (option.type === "chest") {
                    drawTile(this.tiles, (option.x * this.tileSize), (option.y * this.tileSize), 6, this.tileSize, this.tileSize);
                }
                if (option.type === "attack") {
                    drawTile(this.tiles, (option.x * this.tileSize), (option.y * this.tileSize), 7, this.tileSize, this.tileSize);
                }
                if (option.type === "shoot") {
                    setAlpha(0.7);
                    drawTile(this.tiles, (option.x * this.tileSize), (option.y * this.tileSize), 40, this.tileSize, this.tileSize);
                }
                if (option.type === "magic") {
                    setAlpha(1);
                    drawTile(this.tiles, (option.x * this.tileSize) + (this.tileSize / 4), (option.y * this.tileSize) + (this.tileSize / 4), 36, this.tileSize / 2, this.tileSize / 2);
                }
                if (option.type === "heal") {
                    setAlpha(0.7);
                    drawTile(this.tiles, (option.x * this.tileSize) + (this.tileSize / 4), (option.y * this.tileSize) + (this.tileSize / 4), 70, this.tileSize / 2, this.tileSize / 2);
                }
            }
            setAlpha(1);
        }
    }

    // render the actual dungeon tiles. Theres not clipping here yet since dungeons aren't
    // that big. Should really only render what would be in view
    renderDungeon(): void {
        if (this.game && this.myActor) {
            const dungeon = getDungeonById(this.game, this.stairsEvent ? this.stairsEvent.value : this.myActor.dungeonId);
            if (!dungeon) {
                return;
            }

            pushState();


            // work out the camera position based on the local actor
            let x = this.myActor.x;
            let y = this.myActor.y;
            if (this.stairsEvent) {
                x = this.stairsEvent.x;
                y = this.stairsEvent.y;
            }

            const delta = Rune.gameTime() - this.myActor.lt;
            if (delta < STEP_TIME) {
                const lerp = delta / STEP_TIME;
                x = (this.myActor.x * lerp) + (this.myActor.lx * (1 - lerp));
                y = (this.myActor.y * lerp) + (this.myActor.ly * (1 - lerp));
            }

            if (this.myActor.health > 0) {
                this.offsetx = Math.floor((screenWidth() / 2) - (x * this.tileSize) - 32);
                this.offsety = Math.floor((screenHeight() / 2) - (y * this.tileSize) - 32);
            }
            translate(this.offsetx, this.offsety);

            // for each room render the tiles of the floor and walls and any doors that 
            // are part of the room
            for (const room of dungeon.rooms) {
                if (!room.discovered) {
                    continue;
                }

                for (let x = 0; x < room.width; x++) {
                    for (let y = 0; y < room.height; y++) {
                        const tx = room.x + x;
                        const ty = room.y + y;

                        drawTile(this.tiles, tx * this.tileSize, ty * this.tileSize, 89 + (Math.abs((tx * ty) % 2)) * 8, this.tileSize, this.tileSize);
                        const door = getDoorAt(dungeon, tx, ty);
                        if (door) {
                            if (door.open) {
                                drawTile(this.tiles, tx * this.tileSize, ty * this.tileSize, 98, this.tileSize, this.tileSize);
                            } else {
                                drawTile(this.tiles, tx * this.tileSize, ty * this.tileSize, 99, this.tileSize, this.tileSize);
                            }
                        } else {
                            // theres some randomness here to make the walls sides and top vary from a list of potential images. it's
                            // based on the x/y position so its deterministic 
                            if (getWallAt(dungeon, tx, ty)) {
                                if (getWallAt(dungeon, tx, ty + 1)) {
                                    drawTile(this.tiles, tx * this.tileSize, ty * this.tileSize, WALL_TOPS[Math.abs(((tx * ty) % WALL_TOPS.length))], this.tileSize, this.tileSize);
                                } else {
                                    drawTile(this.tiles, tx * this.tileSize, ty * this.tileSize, WALL_FRONTS[Math.abs(((tx * ty) % WALL_FRONTS.length))], this.tileSize, this.tileSize);
                                }
                            }
                        }

                        const chest = getChestAt(dungeon, tx, ty);
                        if (chest) {
                            const offset = 5;
                            const size = (this.tileSize) - (offset * 2);
                            if (chest.open) {
                                drawTile(this.tiles, (tx * this.tileSize) + offset, (ty * this.tileSize) + offset, 66, size, size);
                            } else {
                                drawTile(this.tiles, (tx * this.tileSize) + offset, (ty * this.tileSize) + offset, 74, size, size);
                            }
                        }
                    }
                }

                // if we're in the start room, draw the stairs
                if (room.start) {
                    drawTile(this.tiles, (room.x + room.width - 2) * this.tileSize, (room.y + 1) * this.tileSize, 88, this.tileSize, this.tileSize);
                }

                // if we're in the last room, draw the stairs down
                if (room.stairsDown) {
                    drawTile(this.tiles, (room.x + Math.floor(room.width / 2)) * this.tileSize, (room.y + Math.floor(room.height / 2)) * this.tileSize, 96, this.tileSize, this.tileSize);
                }
            }

            // draw the actors with their movements if required
            this.moving = false;
            for (const actor of dungeon.actors) {
                const room = getRoomAt(dungeon, actor.x, actor.y);
                if (room?.discovered) {
                    let yoffset = -5;
                    let frameOffset = 0;

                    // if the actor is who needs to move then animate them
                    if (actor.playerId === this.game.whoseTurn) {
                        if (Math.floor(this.anim / 15) % 2 === 0) {
                            frameOffset = 16;
                        }
                    }

                    // each move from tile to tile takes "STEP_TIME". We'll linearly 
                    // interpolate across that time frame to have the actor move smoothly 
                    // from one tile to another
                    let x = actor.x;
                    let y = actor.y;
                    const delta = Rune.gameTime() - actor.lt;
                    if (delta < STEP_TIME) {
                        const lerp = delta / STEP_TIME;
                        x = (actor.x * lerp) + (actor.lx * (1 - lerp));
                        y = (actor.y * lerp) + (actor.ly * (1 - lerp));
                        // add a little bounce to the moves
                        yoffset = -Math.sin(lerp * Math.PI) * 13;
                        this.moving = true;
                    }

                    const marker = this.markers.find(m => m.source?.id === actor.id);
                    if (marker && (Math.abs(marker.x - actor.x) + Math.abs(marker.y - actor.y) === 1)) {
                        if (Date.now() - marker.created < 150) {
                            const delta = ((Date.now() - marker.created) / 150) * Math.PI;
                            const offset = (Math.sin(delta) / 2);
                            x = (x * (1 - offset) + (marker.x * offset));
                            y = (y * (1 - offset) + (marker.y * offset));
                        }
                    }
                    pushState();
                    translate(x * this.tileSize, (y * this.tileSize) + yoffset);
                    if (actor.facingRight) {
                        drawTile(this.tiles, 0, 0, actor.sprite + frameOffset, this.tileSize, this.tileSize);
                    } else {
                        scale(-1, 1);
                        drawTile(this.tiles, -this.tileSize, 0, actor.sprite + frameOffset, this.tileSize, this.tileSize);
                    }
                    popState();
                }
            }

            // death markers, spinning actor
            for (const marker of this.markers) {
                if (marker.type === "died") {
                    let delta = (Date.now() - (marker.created + marker.delay)) / 1000;
                    if (delta < 0) {
                        delta = 0;
                    }
                    pushState();
                    setAlpha(1 - delta);
                    translate(marker.x * this.tileSize, (marker.y * this.tileSize) - 5);
                    translate(this.tileSize / 2, this.tileSize / 2);
                    rotate(delta * Math.PI * 2);
                    translate(-this.tileSize / 2, -this.tileSize / 2);
                    drawTile(this.tiles, 0, 0, marker.value, this.tileSize, this.tileSize);
                    popState();
                }
            }

            // damage markers - floating number blobs
            for (const marker of this.markers) {
                if (marker.type === "damage" || marker.type === "heal") {
                    // don't draw before delay
                    if (Date.now() < marker.created + marker.delay) {
                        continue;
                    }
                    const cx = (marker.x * this.tileSize) + (this.tileSize / 2)
                    const cy = (marker.y * this.tileSize) + (this.tileSize / 2) - 4;
                    let circleColor = RED;
                    let textColor = "white";
                    if (marker.value === 0) {
                        circleColor = "#eee";
                        textColor = "black";
                    }
                    if (marker.type === "heal") {
                        circleColor = GREEN;
                        textColor = "white";
                    }
                    const delta = (Date.now() - (marker.created + marker.delay)) / 1000;
                    fillCircle(cx, cy - (delta * 20), 8, circleColor);
                    drawText(cx - 3, cy + 3 - (delta * 20), marker.value + "", 12, textColor);
                }
            }

            // projectiles - rotated sprites that travel between two points
            for (const projectile of this.projectiles) {
                const delta = (Date.now() - projectile.created) / PROJECTILE_TIME;
                const x = projectile.dx - projectile.sx;
                const y = projectile.dy - projectile.sy;
                // adjust for the arrow already being at 45 degrees
                const ang = Math.atan2(y, x) - (Math.PI / 4) + (Math.PI / 2);
                pushState();
                translate((projectile.sx + (x * delta)) * this.tileSize, (projectile.sy + (y * delta)) * this.tileSize);
                translate(this.tileSize / 2, this.tileSize / 2);
                rotate(ang);
                translate(-this.tileSize / 2, -this.tileSize / 2);
                drawTile(this.tiles, 0, 0, projectile.sprite, this.tileSize, this.tileSize);
                popState();
            }

            // if this player is able to move and nothing else is happening then
            // display the options for movement
            if (this.myTurn && !this.game.currentActivity && !this.moving) {
                this.renderOptions();
            }

            // debug evil move options
            // if (this.game.whoseTurn === "evil") {
            //     this.renderOptions();
            // }

            popState();
        }
    }
}
