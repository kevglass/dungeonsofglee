import { PlayerId } from "rune-sdk";
import { GameState, addGameEvent } from "./logic";
import { PlayerClass } from "./player";
import { getActorById } from "./dungeon";

export type ItemType =
    "heal-potion" |
    "mana-potion" |
    "axe" |
    "broadsword" |
    "sabre" |
    "warhammer" |
    "helmet" |
    "longbow" |
    "armour"


export interface ItemInfo {
    icon: number;
    onlyUsedBy?: PlayerClass[];
    sound?: string;
    name: string;
    desc: string;
    attack?: number;
    defense?: number;
    health?: number;
    magic?: number;
}

// evil internalised configuration that should
// be in asset management somewhere
const ITEMS: Record<ItemType, ItemInfo> = {
    "heal-potion": {
        icon: 76,
        sound: "glug",
        name: "Health Potion",
        desc: "Heal 1 Point of Health",
        health: 1
    },
    "mana-potion": {
        icon: 75,
        sound: "glug",
        onlyUsedBy: ["witch"],
        name: "Mana Potion",
        desc: "Recover 1 Magic Point",
        magic: 1
    },
    "axe": {
        icon: 44,
        sound: "weapon",
        onlyUsedBy: ["dwarf"],
        name: "Mighty Axe",
        desc: "Attack +1",
        attack: 1
    },
    "broadsword": {
        icon: 45,
        sound: "weapon",
        onlyUsedBy: ["knight"],
        name: "Broadsword",
        desc: "Attack +1",
        attack: 1
    },
    "sabre": {
        icon: 46,
        sound: "weapon",
        onlyUsedBy: ["knight"],
        name: "Sabre",
        desc: "Attack +2",
        attack: 2
    },
    "warhammer": {
        icon: 43,
        sound: "weapon",
        onlyUsedBy: ["dwarf"],
        name: "War Hammer",
        desc: "Attack +2",
        attack: 2
    },
    "helmet": {
        icon: 51,
        sound: "weapon",
        onlyUsedBy: ["dwarf", "knight", "elf"],
        name: "Helmet",
        desc: "Defense +1",
        defense: 1
    },
    "longbow": {
        icon: 41,
        sound: "weapon",
        onlyUsedBy: ["elf"],
        name: "Helmet",
        desc: "Attack +1",
        attack: 1
    },
    "armour": {
        icon: 52,
        sound: "weapon",
        onlyUsedBy: ["dwarf", "knight", "elf"],
        name: "Armour",
        desc: "Defense +2",
        defense: 2
    }
}

export function getItemInfo(type: ItemType): ItemInfo {
    return ITEMS[type];
}

export interface Item {
    id: number;
    count: number;
    type: ItemType;
}

export interface ItemChance {
    type: ItemType;
    chance: number;
    minLevel: number;
}

export function createItem(game: GameState, type: ItemType) {
    return {
        id: game.nextId++,
        count: 1,
        type
    }
}

export function addItemToInventory(game: GameState, item: Item) {
    const existing = game.items.find(i => i.type === item.type);
    if (existing) {
        existing.count += item.count;
    } else {
        game.items.push(item);
    }
}

export function removeItemFromInventory(game: GameState, type: ItemType) {
    const item = game.items.find(i => i.type === type);
    if (item) {
        if (item.count === 1) {
            game.items.splice(game.items.indexOf(item), 1);
        } else {
            item.count--;
        }
    }
}
const ITEM_IN_CHEST_CHANCE: ItemChance[] = [
    { type: "axe", chance: 0.04, minLevel: 3 },
    { type: "broadsword", chance: 0.04, minLevel: 3 },
    { type: "longbow", chance: 0.04, minLevel: 3 },
    { type: "helmet", chance: 0.04, minLevel: 3 },
    { type: "warhammer", chance: 0.04, minLevel: 8 },
    { type: "sabre", chance: 0.04, minLevel: 8 },
    { type: "armour", chance: 0.04, minLevel: 8 },
    { type: "mana-potion", chance: 0.1, minLevel: 0 },
    { type: "heal-potion", chance: 1, minLevel: 0 }
];

export function rollChestItem(level: number): ItemType {
    for (const chance of ITEM_IN_CHEST_CHANCE) {
        if (level >= chance.minLevel && Math.random() < chance.chance) {
            return chance.type as ItemType;
        }
    }

    return "heal-potion";
}

// use an item from the inventory
export function useItem(game: GameState, playerId: PlayerId, item: Item): void {
    const playerInfo = game.playerInfo[playerId];
    if (playerInfo) {
        const actor = getActorById(game, playerInfo.dungeonId, playerInfo.actorId);
        if (actor) {
            const itemInfo = ITEMS[item.type];
            if (itemInfo.health) {
                if (actor.health < actor.maxHealth) {
                    actor.health += itemInfo.health;
                }
            }
            if (itemInfo.magic) {
                if (actor.magic < actor.maxMagic) {
                    actor.magic += itemInfo.magic;
                }
            }
            if (itemInfo.attack) {
                actor.modAttack += itemInfo.attack;
            }
            if (itemInfo.defense) {
                actor.modDefense += itemInfo.defense;
            }

            removeItemFromInventory(game, item.type);
            addGameEvent(game, actor.id, "useItem", 0, 0, 0, 0, item.type);
        }
    }
}
