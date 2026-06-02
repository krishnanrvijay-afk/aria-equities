const express = require("express");
const path    = require("path");

const app  = express();
const PORT = process.env.PORT || 3000;

// Serve Vite build output
app.use(express.static(path.join(__dirname, "dist")));

// SPA fallback — all routes serve index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`ARIA Equities Terminal running on port ${PORT}`);
});