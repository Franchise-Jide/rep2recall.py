import { Router } from "express";
import asyncHandler from "express-async-handler";
import fileUpload, { UploadedFile } from "express-fileupload";
import uuid from "uuid/v4";
import path from "path";
import fs from "fs";
import Anki from "../engine/anki";
import { g } from "../config";
import Db from "../engine/db";
import { mongoFilter } from "../engine/search";
import sanitize from "sanitize-filename";

const router = Router();
router.use(fileUpload());

const idToFilename: {[key: string]: string} = {};

router.post("/import", asyncHandler(async (req, res) => {
    const id = uuid();
    const file = req.files!.file as UploadedFile;
    fs.writeFileSync(path.join(g.TMP_FOLDER, id), file.data);
    idToFilename[id] = file.name;

    return res.json({id});
}));

g.IO!.on("connection", (socket: any) => {
    socket.on("message", (msg: any) => {
        const {id, type} = msg;
        if (type === ".apkg") {
            const anki = new Anki(path.join(g.TMP_FOLDER, id), idToFilename[id], (p: any) => {
                g.IO!.send(p);
            });
    
            anki.export(g.DB)
            .then(() => anki.close())
            .catch((e) => {
                g.IO!.send({
                    error: e.toString()
                });
            });
        } else {
            const xdb = new Db(path.join(g.TMP_FOLDER, id));

            g.DB.getAll()
            .then(xdb.insertMany)
            .then(xdb.close)
            .catch((e) => {
                g.IO!.send({
                    error: e.toString()
                });
            });
        }
    });
});

router.get("/export", asyncHandler(async (req, res) => {
    const {deck, reset} = req.query;
    const filepath = path.join(g.TMP_FOLDER, uuid());
    const newDb = new Db(filepath);
    const db = g.DB;

    await newDb.build();

    await newDb.insertMany((await db.getAll()).filter(mongoFilter({$or: [
        {deck: deck},
        {deck: {$startswith: `${deck}/`}}
    ]})).map((c) => {
        if (reset) {
            delete c.srsLevel;
            delete c.nextReview;
            delete c.stat;
        }

        return c;
    }));

    await newDb.close();

    return res.download(filepath, `${sanitize(deck)}.r2r`);
}));

export default router;
