const dns = require('dns');
const { ServerApiVersion } = require('mongodb');

/**
 * Run before mongoose.connect when using mongodb+srv (SRV + TXT DNS lookups).
 * - MONGODB_DNS_SERVERS: comma-separated resolvers (e.g. 8.8.8.8,8.8.4.4) if ISP DNS refuses TXT.
 * - Prefer IPv4 first on Node versions that support it (common Windows fix).
 */
function configureMongoDns() {
  const raw = process.env.MONGODB_DNS_SERVERS;
  if (raw && typeof dns.setServers === 'function') {
    const list = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length) dns.setServers(list);
  }
  if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
  }
}

/** Passed to mongoose.connect alongside the URI (matches Atlas Node driver sample). */
const MONGOOSE_CONNECT_OPTS = {
  serverSelectionTimeoutMS: 25_000,
  family: 4,
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true
  }
};

module.exports = { configureMongoDns, MONGOOSE_CONNECT_OPTS };
