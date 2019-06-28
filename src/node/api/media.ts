import { Router } from "express";
import asyncHandler from "express-async-handler";
import { g } from "../config";
import path from "path";
import fs from "fs";

const router = Router();

router.get("/*", asyncHandler(async (req, res) => {
    const db = g.DB;
    const m = await db.conn.get(`
    SELECT data FROM media WHERE id = ?`, req.params[0]);

    if (m) {
        return res.send(m.data);
    } else {
        const p = path.join(g.MEDIA_FOLDER, req.params[0]);
        if (fs.existsSync(p)) {
            return res.send(fs.readFileSync(p));
        }
    }

    return res.sendStatus(404);
}));

export default router;