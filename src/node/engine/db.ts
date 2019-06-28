import sqlite from "sqlite";
import { ankiMustache } from "../util";
import SparkMD5 from "spark-md5";
import uuid from "uuid/v4";
import { ISearchParserResult, mongoFilter, sorter } from "./search";
import { srsMap, getNextReview, repeatReview } from "./quiz";

export interface IDataSocket {
    key: string;
    value: any;
}

export interface IEntry {
    id?: number;
    front: string;
    back?: string;
    mnemonic?: string;
    tag?: string[];
    srsLevel?: number;
    nextReview?: string;
    created?: string;
    modified?: string;
    stat?: {
        streak: {
            right: number;
            wrong: number;
        }
    }
    deck: string;
    template?: string;
    model?: string;
    tFront?: string;
    tBack?: string;
    css?: string;
    js?: string;
    key?: string;
    data?: IDataSocket[];
    source?: string;
    sH?: string;
    sCreated?: string;
}

interface ICondOptions {
    offset?: number;
    limit?: number;
    sortBy?: string;
    desc?: boolean;
    fields?: string[];
}

interface IPagedOutput<T> {
    data: T[];
    count: number;
}

export default class Db {
    public conn!: sqlite.Database;

    private filename: string;

    constructor(filename: string) {
        this.filename = filename;
    }

    public async build() {
        this.conn = await sqlite.open(this.filename);

        this.conn.exec(`
        CREATE TABLE IF NOT EXISTS deck (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            name    VARCHAR UNIQUE NOT NULL
        );
        CREATE TABLE IF NOT EXISTS source (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        VARCHAR NOT NULL /* NOT UNIQUE */,
            h           VARCHAR UNIQUE,
            created     VARCHAR NOT NULL
        );
        CREATE TABLE IF NOT EXISTS template (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            sourceId    INTEGER REFERENCES source(id),
            name        VARCHAR,
            model       VARCHAR,
            front       VARCHAR NOT NULL,
            back        VARCHAR,
            css         VARCHAR,
            js          VARCHAR,
            UNIQUE (sourceId, name, model)
        );
        CREATE TABLE IF NOT EXISTS note (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            sourceId    INTEGER REFERENCES source(id),
            key         VARCHAR,
            data        VARCHAR NOT NULL /* JSON */,
            UNIQUE (sourceId, key)
        );
        CREATE TABLE IF NOT EXISTS media (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            sourceId    INTEGER REFERENCES source(id),
            name        VARCHAR NOT NULL,
            data        BLOB NOT NULL,
            h           VARCHAR NOT NULL
        );
        CREATE TABLE IF NOT EXISTS card (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            deckId      INTEGER NOT NULL REFERENCES deck(id),
            templateId  INTEGER REFERENCES template(id),
            noteId      INTEGER REFERENCES note(id),
            front       VARCHAR NOT NULL,
            back        VARCHAR,
            mnemonic    VARCHAR,
            srsLevel    INTEGER,
            nextReview  VARCHAR,
            /* tag */
            created     VARCHAR,
            modified    VARCHAR,
            stat        VARCHAR
        );
        CREATE TABLE IF NOT EXISTS tag (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            name    VARCHAR UNIQUE NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cardTag (
            cardId  INTEGER NOT NULL REFERENCES card(id) ON DELETE CASCADE,
            tagId   INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
            PRIMARY KEY (cardId, tagId)
        );
        `);
    }

    public async close() {
        await this.conn.close();
    }

    public async getAll(): Promise<IEntry[]> {
        const tags: any[] = [];
        const entries = (await this.conn.all(`
        SELECT
            c.id AS id,
            c.front AS front,
            c.back AS back,
            mnemonic,
            /* tag */
            srsLevel,
            nextReview,
            d.name AS deck,
            c.created AS created,
            modified,
            t.name AS template,
            t.model AS model,
            t.front AS tFront,
            t.back AS tBack,
            css,
            js,
            n.key AS "key",
            n.data AS data,
            s.name AS source,
            s.h AS sH,
            s.created AS sCreated,
            stat
        FROM card AS c
        INNER JOIN deck AS d ON d.id = deckId
        LEFT JOIN template AS t ON t.id = templateId
        LEFT JOIN note AS n ON n.id = noteId
        LEFT JOIN source AS s ON s.id = n.sourceId
        `)).map((el) => {
            tags.push(this.conn.all(`
            SELECT name
            FROM tag
            INNER JOIN cardTag AS ct ON ct.tagId = tag.id
            WHERE ct.cardId = ?`, el.id));

            el.data = JSON.parse(el.data || "[]");
            el.stat = JSON.parse(el.stat || "{}");

            return el;
        });

        (await Promise.all(tags)).map((t, i) => {
            entries[i].tag = t.map((t0: any) => t0.name);
        });

        return entries;
    }

    public async parseCond(
        cond: Partial<ISearchParserResult> | null,
        options: ICondOptions = {}
    ): Promise<IPagedOutput<Partial<IEntry>>> {
        if (!cond || !cond.cond) {
            cond = {cond: {}};
        }
        
        const allCards = (await this.getAll()).filter(mongoFilter(cond.cond))
            .sort(sorter(cond.sortBy || "deck", cond.desc));

        options.offset = options.offset || 0;

        return {
            data: allCards.slice(options.offset, options.limit ? options.offset + options.limit : undefined).map((c) => {
                if (options.fields) {
                    for (const k of Object.keys(c)) {
                        if (!options.fields.includes(k)) {
                            delete (c as any)[k];
                        }
                    }
                }

                return c;
            }),
            count: allCards.length
        };
    }

    public async insertMany(entries_: IEntry[]): Promise<number[]> {
        const entries = await Promise.all(entries_.map((e) => this.transformCreateOrUpdate(null, e)));
        const deckNameToId: {[key: string]: number} = {};

        for (const deck of new Set(entries.map((e) => e.deck))) {
            deckNameToId[deck!] = await this.getOrCreateDeck(deck!);
        }

        const sourceHToId: {[key: string]: number} = {};
        const sourceSet = new Set<string>();

        for (const e of entries.filter((e) => e.sH)) {
            if (!sourceSet.has(e.sH!)) {
                await this.conn.run(`
                INSERT INTO source (name, created, h)
                VALUES (?, ?, ?)
                ON CONFLICT DO NOTHING`, e.source, e.sCreated, e.sH);

                sourceHToId[e.sH!] = (await this.conn.get(`
                SELECT id FROM source
                WHERE h = ?`, e.sH)).id;

                sourceSet.add(e.sH!);
            }
        }

        const templateKeyToId: {[key: string]: number} = {};
        for (const e of entries.filter((e) => e.tFront)) {
            await this.conn.run(`
            INSERT INTO template (name, model, front, back, css, js, sourceId)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT DO NOTHING`,
            e.template,
            e.model,
            e.tFront,
            e.tBack,
            e.css,
            e.js,
            sourceHToId[e.sH!]);

            templateKeyToId[`${e.template}\x1f${e.model}`] = (await this.conn.get(`
            SELECT id FROM template
            WHERE
                sourceId = ? AND
                name = ? AND
                model = ?`, sourceHToId[e.sH!], e.template, e.model)).id
        }

        const noteKeyToId: {[key: string]: number} = {};
        for (const e of entries) {
            if (e.data) {
                try {
                    noteKeyToId[e.key!] = (await this.conn.run(`
                    INSERT INTO note (sourceId, key, data)
                    VALUES (?, ?, ?)`, sourceHToId[e.sH!], e.key, JSON.stringify(e.data))).lastID;
                } catch (e) {
                    noteKeyToId[e.key!] = (await this.conn.get(`
                    SELECT id FROM note
                    WHERE
                        sourceId = ? AND
                        key = ?`, sourceHToId[e.sH!], e.key)).id;
                }
            }
        }

        const now = (new Date()).toISOString();
        const cardIds: number[] = [];

        for (const e of entries) {
            const id = (await this.conn.run(`
            INSERT INTO card
            (front, back, mnemonic, nextReview, deckId, noteId, templateId, created, srsLevel, stat)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            e.front,
            e.back,
            e.mnemonic,
            e.nextReview ? e.nextReview.toString() : null,
            deckNameToId[e.deck!],
            noteKeyToId[e.key!],
            templateKeyToId[`${e.template}\x1f${e.model}`],
            now,
            e.srsLevel,
            JSON.stringify(e.stat)
            )).lastID;

            cardIds.push(id);

            if (e.tag) {
                for (const t of e.tag) {
                    this.conn.run(`
                    INSERT INTO tag (name)
                    VALUES (?)
                    ON CONFLICT DO NOTHING`, t);

                    this.conn.run(`
                    INSERT INTO cardTag (cardId, tagId)
                    VALUES (
                        ?,
                        (SELECT id FROM tag WHERE name = ?)
                    )
                    ON CONFLICT DO NOTHING`, id, t);
                }
            }
        }

        return cardIds;
    }

    public async update(cardId: number, u: Partial<IEntry> = {}, doCommit: boolean = true) {
        u = await this.transformCreateOrUpdate(cardId, u);

        for (const k of Object.keys(u)) {
            if (k === "deck") {
                const deckId = await this.getOrCreateDeck((u as any)[k]);
                await this.conn.run(`
                UPDATE card
                SET deckId = ?
                WHERE id = ?`, deckId, cardId);
            } else if (["nextReview", "created", "modified",
            "front", "back", "mnemonic", "srsLevel"].includes(k)) {
                await this.conn.run(`
                UPDATE card
                SET ${k} = ?
                WHERE id = ?`, (u as any)[k], cardId);
            } else if (["css", "js"].includes(k)) {
                await this.conn.run(`
                UPDATE template
                SET ${k} = ?
                WHERE template.id = (
                    SELECT templateId FROM card WHERE card.id = ?
                )`, (u as any)[k], cardId)
            } else if (["tFront", "tBack"].includes(k)) {
                await this.conn.run(`
                UPDATE template
                SET ${k.substr(1).toLocaleLowerCase()} = ?
                WHERE template.id = (
                    SELECT templateId FROM card WHERE card.id = ?
                )`, (u as any)[k], cardId)
            } else if (k === "tag") {
                const prevTags = await this.getTags(cardId);
                const tagsToAdd = (u as any)[k].filter((t: any) => !prevTags.includes(t));
                const tagsToRemove = prevTags.filter((t) => !(u as any)[k].includes(t));
                await this.addTags(cardId, tagsToAdd, prevTags);
                await this.removeTags(cardId, tagsToRemove, prevTags);
            } else if (k === "data") {
                const data = await this.getData(cardId);
                for (const vn of (u as any)[k]) {
                    let isNew = true;
                    data.forEach((d, i) => {
                        if (d.key === vn.key) {
                            data[i].value = vn.value;
                            isNew = false;
                        }
                    })

                    if (isNew) {
                        data.push(vn);
                    }
                }

                let noteId = (await this.conn.get(`
                SELECT noteId FROM card WHERE card.id = ?`, cardId)).noteId

                if (noteId) {
                    await this.conn.run(`
                    UPDATE note
                    SET data = ?
                    WHERE note.id = ?`, JSON.stringify(data), noteId);
                } else {
                    noteId = (await this.conn.run(`
                    INSERT INTO note (key, data)
                    VALUES (?, ?)`, uuid(), JSON.stringify(data))).lastID;

                    await this.conn.run(`
                    UPDATE card
                    SET noteId = ?
                    WHERE id = ?`, noteId, cardId);
                }
            }
        }
    }

    public async updateMany(cardIds: number[], u: Partial<IEntry> = {}) {
        for (const id of cardIds) {
            await this.update(id, u);
        }
    }

    public async deleteMany(cardIds: number[]) {
        const q = "?,".repeat(cardIds.length);

        await this.conn.run(`
        DELETE FROM card
        WHERE id IN (${q.substr(0, q.length - 1)})`, ...cardIds)
    }

    private async transformCreateOrUpdate(cardId: number | null, u: Partial<IEntry> = {}): Promise<Partial<IEntry>> {
        if (cardId) {
            u.created = (new Date()).toISOString();
        } else {
            u.modified = (new Date()).toISOString();
        }

        let data: IDataSocket[] | null = null;
        let front: string = "";

        if ((u.front || "").startsWith("@template\n")) {
            if (!data) {
                if (cardId) {
                    data = await this.getData(cardId);
                } else {
                    data = u.data || [];
                }
            }
            u.tFront = (u.front || "").substr("@template\n".length);
            delete u.front;
        }

        if (u.tFront) {
            front = ankiMustache(u.tFront, data || []);
            u.front = "@md5\n" + SparkMD5.hash(front);
        }

        if ((u.back || "").startsWith("@template\n")) {
            u.tBack = (u.back || "").substr("@template\n".length);
            delete u.back;
        }

        if (u.tBack) {
            if (!front && cardId) {
                front = await this.getFront(cardId);
            }
            u.back = ankiMustache(u.tBack, data || [], front);
        }

        return u;
    }

    private async getData(cardId: number): Promise<IDataSocket[]> {
        return JSON.parse((await this.conn.get(`
        SELECT data FROM note
        WHERE note.id = (SELECT noteId FROM card WHERE card.id = ?)`, cardId)).data || "[]")
    }

    private async getFront(cardId: number): Promise<string> {
        let {front} = await this.conn.get("SELECT front FROM card WHERE id = ?", cardId);

        if (front.startsWith("@md5\n")) {
            const {tFront, data} = await this.conn.get(`
            SELECT t.front AS tFront, data
            FROM card AS c
            LEFT JOIN template AS t ON t.id = templateId
            LEFT JOIN note AS n ON n.id = noteId
            WHERE c.id = ?`, cardId);

            if (tFront && data) {
                front = ankiMustache(tFront, JSON.parse(data));
            }
        }

        return front;
    }

    private async getOrCreateDeck(name: string): Promise<number> {
        await this.conn.run(`
        INSERT INTO deck (name)
        VALUES (?)
        ON CONFLICT DO NOTHING`, name);

        return (await this.conn.get(`
        SELECT id FROM deck
        WHERE name = ?`, name)).id;
    }

    private async getTags(cardId: number): Promise<string[]> {
        return (await this.conn.all(`
        SELECT name
        FROM tag AS t
        INNER JOIN cardTag AS ct ON ct.tagId = t.id
        INNER JOIN card AS c ON ct.cardId = c.id
        WHERE c.id = ?`, cardId)).map((t) => t.name);
    }

    public async addTags(cardId: number, tags: string[], prevTags: string[] | null = null) {
        prevTags = prevTags || await this.getTags(cardId);
        const tagsToAdd = tags.filter((t) => !prevTags!.includes(t));

        for (const t of tagsToAdd) {
            await this.conn.run(`
            INSERT INTO tag (name)
            VALUES (?)
            ON CONFLICT DO NOTHING`, t);

            await this.conn.run(`
            INSERT INTO cardTag (cardId, tagId)
            VALUES (
                ?,
                (SELECT tag.id FROM tag WHERE tag.name = ?)
            )
            ON CONFLICT DO NOTHING`, cardId, t);
        }
    }

    public async removeTags(cardId: number, tags: string[], prevTags: string[] | null = null) {
        prevTags = prevTags || await this.getTags(cardId);
        const tagsToRemove = tags.filter((t) => prevTags!.includes(t));

        for (const t of tagsToRemove) {
            await this.conn.run(`
            DELETE FROM cardTag
            WHERE
                cardId = ? AND
                tagId = (
                    SELECT id FROM tag WHERE name = ?
                )`, cardId, t);
        }
    }

    public async render(cardId: number): Promise<any> {
        const r = await this.parseCond({
            cond: {id: cardId}
        }, {
            limit: 1,
            fields: ["front", "back", "mnemonic", "tFront", "tBack", "data"]
        });

        const c = r.data[0];
        const {tFront, tBack, data} = c;
        
        if (/@md5\n/.test(c.front!)) {
            c.front = ankiMustache(tFront || "", data);
        }

        if (/@md5\n/.test(c.back || "")) {
            c.back = ankiMustache(tBack || "", data, c.front);
        }

        return {
            front: c.front,
            back: c.back,
            mnemonic: c.mnemonic
        }
    }

    public async markRight(cardId?: number, cardData?: {[k: string]: any}): Promise<number | null> {
        return await this.createAndUpdateCard(+1, cardId, cardData);
    }

    public async markWrong(cardId?: number, cardData?: {[k: string]: any}): Promise<number | null> {
        return await this.createAndUpdateCard(-1, cardId, cardData);
    }

    private async createAndUpdateCard(dSrsLevel: number,
            cardId?: number, card?: {[k: string]: any}): Promise<number | null> {
        if (cardId) {
            card = await this.conn.get(`
            SELECT front, back, mnemonic, srsLevel, stat FROM card WHERE id = ?`, cardId);
        }

        if (!card) {
            return null;
        }

        let {srsLevel, stat} = card;
        srsLevel = srsLevel || 0;
        stat = JSON.parse(stat || JSON.stringify({
            streak: {
                right: 0,
                wrong: 0
            }
        }));

        if (dSrsLevel > 0) {
            stat.streak.right++;
        } else if (dSrsLevel < 0) {
            stat.streak.wrong++;
        }

        srsLevel += dSrsLevel;

        if (srsLevel >= srsMap.length) {
            srsLevel = srsMap.length - 1;
        }

        if (srsLevel < 0) {
            srsLevel = 0;
        }

        let nextReview: string;

        if (dSrsLevel > 0) {
            nextReview = getNextReview(srsLevel);
        } else {
            nextReview = repeatReview();
        }

        if (!cardId) {
            cardId = (await this.insertMany([{
                ...(card || {}),
                srsLevel,
                stat,
                nextReview
            } as any]))[0];
        } else {
            await this.updateMany([cardId], {srsLevel, stat, nextReview});
        }

        return cardId!;
    }
}
