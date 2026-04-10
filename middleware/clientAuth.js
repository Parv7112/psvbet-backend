import jwt from "jsonwebtoken";

export const clientAuthMiddleware = (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ message: "No token, authorization denied" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== "client" || !decoded.clientDocId) {
      return res.status(401).json({ message: "Invalid client token" });
    }
    req.clientDocId = decoded.clientDocId;
    next();
  } catch {
    res.status(401).json({ message: "Token is not valid" });
  }
};
