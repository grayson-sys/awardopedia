import { Router } from "express";
import { getGeoSpend } from "../db/queries.js";

const router = Router();

router.get("/spend", async (req, res) => {
  try {
    const { state, sector } = req.query;
    res.json(await getGeoSpend(state || null, sector || null));
  } catch (err) {
    console.error("Geo spend error:", err.message);
    res.status(500).json({ error: "Failed to load geo data" });
  }
});

export default router;
