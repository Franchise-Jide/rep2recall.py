import { Router } from "express";
import asyncHandler from "express-async-handler";
import { g } from "../config";
import { SearchParser } from "../engine/search";

const router = Router();

router.post("/", asyncHandler(async (req, res) => {
    const {q, offset, limit, sortBy, desc} = req.body;
    const parser = new SearchParser();
    const cond = parser.doParse(q);

    const db = g.DB;
    return res.json(await db.parseCond(cond, {offset, limit, sortBy, desc}));
}));

router.put("/", asyncHandler(async (req, res) => {
    const {id, ids, create, update} = req.body;
    const db = g.DB;
    if (Array.isArray(create)) {
        const ids = await db.insertMany(create);
        return res.json({ids});
    } else if (create) {
        const ids = await db.insertMany([create]);
        return res.json({id: ids[0]});
    } else if (ids) {
        return res.json(await db.updateMany(ids, update));
    } else {
        return res.json(await db.updateMany([id], update));
    }
}));

router.delete("/", asyncHandler(async (req, res) => {
    const {id, ids} = req.body;
    const db = g.DB;
    if (ids) {
        return res.json(await db.deleteMany(ids));
    } else {
        return res.json(await db.deleteMany([id]));
    }
}))

router.put("/editTags", asyncHandler(async (req, res) => {
    const {ids, tags} = req.body;
    const db = g.DB;
    return res.json(await db.addTags(ids, tags));
}));

router.delete("/editTags", asyncHandler(async (req, res) => {
    const {ids, tags} = req.body;
    const db = g.DB;
    return res.json(await db.removeTags(ids, tags));
}))

export default router;
