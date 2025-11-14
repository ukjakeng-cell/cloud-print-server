import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// Testing API
app.get("/", (req, res) => {
  res.send("Cloud Print Server Running on Windows!");
});

app.listen(3000, () => {
  console.log("Server started at http://localhost:3000");
});
