
/**
 * Module dependencies.
 */

var debug = require('debug')('koa-ratelimit');
var Limiter = require('ratelimiter');
var ms = require('ms');
var thenify = require('thenify');

/**
 * Expose `ratelimit()`.
 */

module.exports = ratelimit;

/**
 * Initialize ratelimit middleware with the given `opts`:
 *
 * - `duration` limit duration in milliseconds [1 hour]
 * - `max` max requests per `id` [2500]
 * - `db` database connection
 * - `id` id to compare requests [ (ctx) => (return ctx.ip) ]
 * - `headers` custom header names
 *  - `remaining` remaining number of requests ['X-RateLimit-Remaining']
 *  - `reset` reset timestamp ['X-RateLimit-Reset']
 *  - `total` total number of requests ['X-RateLimit-Limit']
 *  - `retry` retry after time ['X-Retry-After']
 * - `errorMsg` text in body of error response ['Rate limit exceeded, retry in ']
 * - `appendRetryTime` append retry time to error body text [true]
 * - `log` logging function to receive error message [(ctx, msg) => ()]
 *
 * @param {Object} opts
 * @return {Function}
 * @api public
 */

function ratelimit(opts) {
  opts = opts || {};
  opts.headers = opts.headers || {};
  opts.headers.remaining = opts.headers.remaining || 'X-RateLimit-Remaining';
  opts.headers.reset = opts.headers.reset || 'X-RateLimit-Reset';
  opts.headers.total = opts.headers.total || 'X-RateLimit-Limit';
  opts.headers.retry = opts.headers.retry || 'X-Retry-After';
  opts.errorMsg = opts.errorMsg || 'Rate limit exceeded, retry in ';
  opts.appendRetryTime = (typeof opts.appendRetryTime !== 'undefined') ? opts.appendRetryTime : true;
  opts.throw = (typeof opts.throw !== 'undefined') ? opts.throw : false;

  return function (ctx, next){
    var id = opts.id ? opts.id(ctx) : ctx.ip;

    if (false === id) return next();

    // initialize limiter
    var limiter = new Limiter({ id: id, __proto__: opts });
    limiter.get = thenify(limiter.get);

    // check limit
    return limiter.get().then((limit) => {
      // check if current call is legit
      var remaining = limit.remaining > 0 ? limit.remaining - 1 : 0;

      // header fields
      var headers = {};
      headers[opts.headers.remaining] = remaining;
      headers[opts.headers.reset] = limit.reset;
      headers[opts.headers.total] = limit.total;

      ctx.set(headers);

      debug('remaining %s/%s %s', remaining, limit.total, id);
      if (limit.remaining) return next();

      var delta = (limit.reset * 1000) - Date.now() | 0;
      var after = limit.reset - (Date.now() / 1000) | 0;
      ctx.set(opts.headers.retry, after);

      ctx.status = 429;
      ctx.body = opts.errorMsg + (opts.appendRetryTime ? ms(delta, { long: true }) : '');
      
      if (opts.log) opts.log(ctx, opts.errorMsg);

      if (opts.throw) ctx.throw(ctx.status, ctx.body, { headers: headers });
    });
  }
}
