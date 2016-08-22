"use strict";
/**
 * Module dependencies.
 */
const engine = require('engine.io');

const Client = require('./client');
const Namespace = require('./namespace');
const Adapter = require('socket.io-adapter');


/**
 * Server constructor.
 *
 * @param {Server} srv http server, port or options
 * @param {Object} opts
 * @api public
 * @type {{new(*=, *=): {of: (function(String, Function)), set: (function(*=, *=)), onconnection: (function(engine.Socket): Server), path: (function(String): (Server|String)), attach: (function(*=, *=): Server), bind: (function(engine.Server): Server), listen: (function(*=, *=)), origins: (function(String): (Server|Adapter)), adapter: (function(Adapter): (Server|Adapter)), close: (function())}}}
 * @export
 */
const Server = class Server{
  constructor(srv, opts = {}){
    if (!(this instanceof Server)) return new Server(srv, opts);
    this.nsps = {};
    this.path(opts.path || '/socket.io');
    this.adapter(opts.adapter || Adapter);
    this.origins(opts.origins || '*:*');
    this.sockets = this.of('/');
    if (srv) this.attach(srv, opts);
  }
  /**
   * Backwards compatiblity.
   *
   * @api public
   */

  set (key, val){
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
  }
  /**
   * Sets the client serving path.
   *
   * @param {String} v pathname
   * @return {Server|String} self when setting or value when getting
   * @api public
   */

  path (v){
    if (!arguments.length) return this._path;
    this._path = v.replace(/\/$/, '');
    return this;
  }
  /**
   * Sets the adapter for rooms.
   *
   * @param {Adapter} v pathname
   * @return {Server|Adapter} self when setting or value when getting
   * @api public
   */

  adapter (v){
    if (!arguments.length) return this._adapter;
    this._adapter = v;
    Object.keys(this.nsps).map( id => this.nsps[id].initAdapter());
    return this;
  }

  /**
   * Sets the allowed origins for requests.
   *
   * @param {String} v origins
   * @return {Server|Adapter} self when setting or value when getting
   * @api public
   */

  origins (v){
    if (!arguments.length) return this._origins;

    this._origins = v;
    return this;
  }


  /**
   * Attaches socket.io to a server or port.
   *
   * @param {http.Server|Number} server or port
   * @param {Object} options passed to engine.io
   * @return {Server} self
   * @api public
   */

  attach (srv, opts = {}){
    // set engine.io path to `/socket.io`
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
  }
  listen (srv, opts = {}) {
    return this.attach.call(this, srv, opts);
  }

  /**
   * Binds socket.io to an engine.io instance.
   *
   * @param {engine.Server} engine engine.io (or compatible) server
   * @return {Server} self
   * @api public
   */

  bind (engine){
    this.engine = engine;
    this.engine.on('connection', this.onconnection.bind(this));
    return this;
  }
  /**
   * Called with each incoming transport connection.
   *
   * @param {engine.Socket} conn
   * @return {Server} self
   * @api public
   */

  onconnection (conn){
    const client = new Client(this, conn);
    client.connect('/');
    return this;
  }
  /**
   * Looks up a namespace.
   *
   * @param {String} name nsp name
   * @param {Function} fn optional, nsp `connection` ev handler
   * @api public
   */

  of (name, fn){
    if (String(name)[0] !== '/') name = '/' + name;

    let nsp = this.nsps[name];
    if (!nsp) {
      nsp = new Namespace(this, name);
      this.nsps[name] = nsp;
    }
    if (fn) nsp.on('connect', fn);
    return nsp;
  }
  /**
   * Closes server connection
   *
   * @api public
   */
  close (){
    Object.keys(this.nsps['/'].sockets).map( id => this.nsps['/'].sockets[id].onclose());
    this.engine.close();

    if(this.httpServer){
      this.httpServer.close();
    }
  }
};

/**
 * Old settings for backwards compatibility
 */

const oldSettings = {
  "transports": "transports",
  "heartbeat timeout": "pingTimeout",
  "heartbeat interval": "pingInterval",
  "destroy buffer size": "maxHttpBufferSize"
};

/**
 * Expose main namespace (/).
 */
['on', 'to', 'in', 'use', 'emit', 'send', 'write', 'clients', 'compress'].map( fn => {
  Server.prototype[fn] = function(...args){
    return this.sockets[fn].apply(this.sockets, [...args]);
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

/**
 * Module exports.
 */

module.exports = Server;
