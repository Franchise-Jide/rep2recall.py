import express, { Router, ErrorRequestHandler } from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import cors from "cors";
import editorRouter from "./api/editor";
import quizRouter from "./api/quiz";
import http from "http";
import SocketIO from "socket.io";
import { g, resourcePath } from "./config";
import asyncHandler from "express-async-handler";
import fs from "fs";

dotenv.config();

const app = express();
const server = new http.Server(app);

g.IO = SocketIO(server);

app.use(express.static(resourcePath("public")));

const apiRouter = Router();
app.use("/api", apiRouter);

apiRouter.use(bodyParser.json());
apiRouter.use(cors());
apiRouter.use("/editor", editorRouter);
apiRouter.use("/io", require("./api/io").default);
apiRouter.use("/quiz", quizRouter);

apiRouter.delete("/reset", asyncHandler(async (req, res) => {
    await g.DB.close();
    fs.unlinkSync(g.COLLECTION);

    return res.json({error: null});
}));

const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    console.error(err.stack)
    res.status(500).send('Something broke!')
};

app.use(errorHandler);

(async () => {
    await g.DB.build();
    server.listen(g.PORT, () => console.log(`Server running on http://localhost:${g.PORT}`));
})();
