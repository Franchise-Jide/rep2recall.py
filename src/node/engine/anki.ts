import fs from "fs";
import AdmZip from "adm-zip";
import path from "path";
import SparkMD5 from "spark-md5";
import sqlite from "sqlite";
import Db from "./db";
import { ankiMustache } from "../util";

export default class Anki {
    private mediaNameToId: any = {};
    private filename: string;
    private filepath: string;
    private dir: string;
    private callback: (res: any) => any;

    constructor(filepath: string, filename: string, callback: (res: any) => any) {
        this.filename = filename;
        this.filepath = filepath;
        this.dir = path.dirname(filepath);
        this.callback = callback;

        const zip = new AdmZip(filepath);
        const zipCount = zip.getEntries().length;

        this.callback({
            text: `Unzipping Apkg. File count: ${zipCount}`,
            max: 0
        });

        zip.extractAllTo(this.dir);
    }

    public async export(dst: Db) {
        this.callback({
            text: "Preparing Anki resources.",
            max: 0
        });

        const anki2 = await sqlite.open(path.join(this.dir, "collection.anki2"));
        const { decks, models } = await anki2.get("SELECT decks, models FROM col");

        await anki2.exec(`
        CREATE TABLE decks (
            id      INTEGER NOT NULL PRIMARY KEY,
            name    VARCHAR NOT NULL
        )`);

        for (const d of Object.values<any>(JSON.parse(decks as string))) {
            await anki2.run("INSERT INTO decks (id, name) VALUES (?, ?)", d.id, d.name);
        }

        await anki2.exec(`
        CREATE TABLE models (
            id      INTEGER NOT NULL PRIMARY KEY,
            name    VARCHAR NOT NULL,
            flds    VARCHAR NOT NULL,
            css     VARCHAR
        )`);

        await anki2.exec(`
        CREATE TABLE templates (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            mid     INTEGER REFERENCES model(id),
            name    VARCHAR NOT NULL,
            qfmt    VARCHAR NOT NULL,
            afmt    VARCHAR
        )`);

        for (const m of Object.values<any>(JSON.parse(models))) {
            await anki2.run("INSERT INTO models (id, name, flds, css) VALUES (?, ?, ?, ?)",
                m.id, m.name, m.flds.map((f: any) => f.name).join("\x1f"), m.css);

            for (const t of m.tmpls) {
                await anki2.run("INSERT INTO templates (mid, name, qfmt, afmt) VALUES (?, ?, ?, ?)",
                    m.id, t.name, t.qfmt, t.afmt);
            }
        }

        this.callback({
            text: "Writing to database",
            max: 0
        });

        let sourceId: number;
        const sH = SparkMD5.ArrayBuffer.hash(fs.readFileSync(this.filepath));
        try {
            sourceId = (await dst.conn.run(`
            INSERT INTO source (name, h, created)
            VALUES (?, ?, ?)`,
            this.filename, sH, (new Date()).toISOString)).lastID;
        } catch (e) {
            this.callback({
                error: `Duplicated resource: ${this.filename}`
            });
            return;
        }

        const mediaJson = JSON.parse(fs.readFileSync(path.join(this.dir, "media"), "utf8"));

        const total = Object.keys(mediaJson).length;
        this.callback({
            text: "Uploading media",
            max: total
        });

        this.mediaNameToId = {};

        for (const m of Object.keys(mediaJson)) {
            const data = fs.readFileSync(path.join(this.dir, m));
            const h = SparkMD5.ArrayBuffer.hash(data);

            await dst.conn.run(`
            INSERT INTO media (sourceId, name, data, h)
            VALUES (?, ?, ?, ?)
            ON CONFLICT DO NOTHING`, sourceId, mediaJson[m], data, h);

            this.mediaNameToId[mediaJson[m]] = (await dst.conn.get(`
            SELECT id FROM media
            WHERE h = ?`, h)).id;
        }

        const templates = await anki2.all(`
        SELECT t.name AS tname, m.name AS mname, qfmt, afmt, css
        FROM templates AS t
        INNER JOIN models AS m ON m.id = t.mid`)

        this.callback({
            text: "Uploading templates",
            max: templates.length
        });

        for (const t of templates) {
            const { tname, mname, qfmt, afmt, css } = t;

            await dst.conn.run(`
            INSERT INTO template (name, model, front, back, css, sourceId)
            VALUES (?, ?, ?, ?, ?, ?)`,
            tname, mname,
            this.convertLink(qfmt),
            this.convertLink(afmt),
            this.convertLink(css),
            sourceId);
        }

        const frontSet = new Set();
        let current = 0;

        const entries = await anki2.all(`
        SELECT
            n.flds AS "values",
            m.flds AS keys,
            t.name AS tname,
            m.name AS mname,
            d.name AS deck,
            qfmt,
            tags
        FROM cards AS c
        INNER JOIN decks AS d ON d.id = did
        INNER JOIN notes AS n ON n.id = nid
        INNER JOIN models AS m ON m.id = n.mid
        INNER JOIN templates AS t ON t.mid = n.mid`);
        
        for (const c of entries) {
            if (!(current % 1000)) {
                this.callback({
                    text: "Uploading notes",
                    current,
                    max: entries.length
                });
            }
            current++;

            const { keys, values, tname, mname, deck, qfmt, tags } = c;
            const vs = (values as string).split("\x1f");

            const data = (keys as string).split("\x1f").map((k, i) => {
                return {
                    key: k,
                    value: vs[i]
                };
            });

            let front = ankiMustache(qfmt as string, data);
            if (front === ankiMustache(qfmt as string, [])) {
                return;
            }

            front = `@md5\n${SparkMD5.hash(this.convertLink(front))}`;

            if (frontSet.has(front)) {
                return;
            }
            frontSet.add(front);

            let tag = (tags as string).split(" ");
            tag = tag.filter((t, i) => t && tag.indexOf(t) === i);

            dst.insertMany([{
                deck: (deck as string).replace(/::/g, "/"),
                model: mname as string,
                template: tname as string,
                key: vs[0],
                data,
                front,
                tag,
                sH
            }])
        };

        anki2.close();
    }

    public close() {
        fs.unlinkSync(this.filepath);
        this.callback({});
    }

    private convertLink(s: string) {
        return s.replace(/(?:(?:href|src)=")([^"]+)(?:")/, (m, p1) => {
            return `/media/${this.mediaNameToId[p1]}`;
        });
    }
}