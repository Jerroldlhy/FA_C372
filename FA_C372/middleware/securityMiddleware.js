const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const getRequestOriginHost = (req) => {
  const origin = String(req.get("origin") || "").trim();
  if (origin) {
    try {
      return new URL(origin).host;
    } catch (err) {
      return null;
    }
  }

  const referer = String(req.get("referer") || "").trim();
  if (referer) {
    try {
      return new URL(referer).host;
    } catch (err) {
      return null;
    }
  }

  return null;
};

const enforceSameOrigin = (req, res, next) => {
  if (SAFE_METHODS.has(String(req.method || "").toUpperCase())) {
    return next();
  }

  const originHost = getRequestOriginHost(req);
  const appHost = String(req.get("host") || "").trim();

  if (!originHost || !appHost) {
    return res.status(403).send("Forbidden");
  }

  if (originHost !== appHost) {
    return res.status(403).send("Forbidden");
  }

  return next();
};

module.exports = {
  enforceSameOrigin,
};

