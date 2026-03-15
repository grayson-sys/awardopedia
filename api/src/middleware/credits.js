export function requireCredits(n = 1) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if ((req.user.credits || 0) < n) {
      return res.status(402).json({
        error: 'Insufficient credits',
        required: n,
        available: req.user.credits || 0,
      });
    }
    next();
  };
}
