"use strict";
/**
 * Module dependencies.
 */
var engine = require('engine.io');

var Client = require('./client');
var Namespace = require('./namespace');
var Adapter = require('socket.io-adapter');

/**
 * Module exports.
 */

module.exports = Server;

/**
 * Server constructor.
 *
 * @param {http.Server|Number|Object} srv http server, port or options
 * @param {Object} opts
 * @api public
 */

function Server(srv, opts){
  if (!(this instanceof Server)) return new Server(srv, opts);
  if ('object' == typeof srv && !srv.listen) {
    opts = srv;
    srv = null;
  }
  opts = opts || {};
  this.nsps = {};
  this.path(opts.path || '/socket.io');
  this.adapter(opts.adapter || Adapter);
  this.origins(opts.origins || '*:*');
  this.sockets = this.of('/');
  if (srv) this.attach(srv, opts);
}

/**
 * Old settings for backwards compatibility
 */

var oldSettings = {
  "transports": "transports",
  "heartbeat timeout": "pingTimeout",
  "heartbeat interval": "pingInterval",
  "destroy buffer size": "maxHttpBufferSize"
};

/**
 * Backwards compatiblity.
 *
 * @api public
 */

Server.prototype.set = function(key, val){
  if ('authorization' == key && val) {
    this.use(function(socket, next) {
      val(socket.request, function(err, authorized) {
        if (err) return next(new Error(err));
        if (!authorized) return next(new Error('Not authorized'));
        next();
      });
    });
  } else if ('origins' == key && val) {
    this.origins(val);
  } else if ('resource' == key) {
    this.path(val);
  } else if (oldSettings[key] && this.eio[oldSettings[key]]) {
    this.eio[oldSettings[key]] = val;
  } else {
    console.error('Option %s is not valid. Please refer to the README.', key);
  }
  return this;
};

/**
 * Sets the client serving path.
 *
 * @param {String} v pathname
 * @return {Server|String} self when setting or value when getting
 * @api public
 */

Server.prototype.path = function(v){
  if (!arguments.length) return this._path;
  this._path = v.replace(/\/$/, '');
  return this;
};

/**
 * Sets the adapter for rooms.
 *
 * @param {Adapter} v pathname
 * @return {Server|Adapter} self when setting or value when getting
 * @api public
 */

Server.prototype.adapter = function(v){
  if (!arguments.length) return this._adapter;
  this._adapter = v;
  Object.keys(this.nsps).map( id => this.nsps[id].initAdapter());
  return this;
};

/**
 * Sets the allowed origins for requests.
 *
 * @param {String} v origins
 * @return {Server|Adapter} self when setting or value when getting
 * @api public
 */

Server.prototype.origins = function(v){
  if (!arguments.length) return this._origins;

  this._origins = v;
  return this;
};

/**
 * Attaches socket.io to a server or port.
 *
 * @param {http.Server|Number} server or port
 * @param {Object} options passed to engine.io
 * @return {Server} self
 * @api public
 */

Server.prototype.listen =
Server.prototype.attach = function(srv, opts){
  // set engine.io path to `/socket.io`
  opts = opts || {};
  opts.path = opts.path || this.path();
  // - `allowRequest` (`Function`): A function that receives a given handshake
  //   or upgrade request as its first parameter, and can decide whether to
  //   continue or not. The second argument is a function that needs to be
  //   called with the decided information: `fn(err, success)`, where
  //   `success` is a boolean value where false means that the request is
  //   rejected, and err is an error code.
  opts.allowRequest = (req, cb) => cb(null, true);

  // initialize engine
  this.eio = engine.attach(srv, opts);

  // Export http server
  this.httpServer = srv;

  // bind to engine events
  this.bind(this.eio);

  return this;
};



/**
 * Binds socket.io to an engine.io instance.
 *
 * @param {engine.Server} engine engine.io (or compatible) server
 * @return {Server} self
 * @api public
 */

Server.prototype.bind = function(engine){
  this.engine = engine;
  this.engine.on('connection', this.onconnection.bind(this));
  return this;
};

/**
 * Called with each incoming transport connection.
 *
 * @param {engine.Socket} conn
 * @return {Server} self
 * @api public
 */

Server.prototype.onconnection = function(conn){
  var client = new Client(this, conn);
  client.connect('/');
  return this;
};

/**
 * Looks up a namespace.
 *
 * @param {String} name nsp name
 * @param {Function} fn optional, nsp `connection` ev handler
 * @api public
 */

Server.prototype.of = function(name, fn){
  if (String(name)[0] !== '/') name = '/' + name;
  
  var nsp = this.nsps[name];
  if (!nsp) {
    nsp = new Namespace(this, name);
    this.nsps[name] = nsp;
  }
  if (fn) nsp.on('connect', fn);
  return nsp;
};

/**
 * Closes server connection
 *
 * @api public
 */

Server.prototype.close = function(){
  Object.keys(this.nsps['/'].sockets).map( id => this.nsps['/'].sockets[id].onclose());
  this.engine.close();

  if(this.httpServer){
    this.httpServer.close();
  }
};

/**
 * Expose main namespace (/).
 */

['on', 'to', 'in', 'use', 'emit', 'send', 'write', 'clients', 'compress'].map( fn => {
  Server.prototype[fn] = function(){
    return this.sockets[fn].apply(this.sockets, arguments);
  };
});

Namespace.flags.map( flag => {
  Server.prototype.__defineGetter__(flag, function(){
    this.sockets.flags = this.sockets.flags || {};
    this.sockets.flags[flag] = true;
    return this;
  });
});

/**
 * BC with `io.listen`
 */

Server.listen = Server;
