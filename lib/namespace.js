"use strict";
/**
 * Module dependencies.
 */

const Socket = require('./socket');
const Emitter = require('events');
const parser = require('socket.io-parser');
const hasBin = require('has-binary');


/**
 * Blacklisted events.
 */

const EventsArr = [
  'connect',    // for symmetry with client
  'connection',
  'newListener'
];

/**
 * Flags.
 */

const Flags = [
  'json',
  'volatile'
];

/**
 * `EventEmitter#emit` reference.
 */

const Emit = Emitter.prototype.emit;

/**
 * Namespace constructor.
 * @constructor
 * @param {Server} server instance
 * @param {Socket} name
 * @api private
 * @type {{new(*, *): {in: (function(*=)), emit: (function(*=): Namespace), add: (function(*=, *=): {in: (function(*=)), ack: (function(Number)), onconnect: (function()), compress: (function(Boolean): Socket), request, ondisconnect: (function()), onevent: (function(Object)), disconnect: (function(Boolean): Socket), send: (function(): Socket), emit: (function(*=): Socket), onpacket: (function(Object)), onerror: (function(*=)), leaveAll: (function()), onclose: (function(String)), error: (function(Object)), to: (function(String): Socket), leave: (function(String, Function): Socket), write: (function()), join: (function(String, Function): Socket), packet: (function(Object, Object)), onack: (function(*)), buildHandshake: (function())}), clients: (function(*=): Namespace), remove: (function(*)), use: (function(*=): Namespace), compress: (function(Boolean): Socket), send: (function(): Namespace), initAdapter: (function()), run: (function(Socket, Function)), to: (function(String): Namespace), write: (function())}}}
 * @export
 */
const Namespace = class Namespace extends Emitter{
  constructor(server, name){
    super();
    this.name = name;
    this.server = server;
    this.sockets = {};
    this.connected = {};
    this.fns = [];
    this.ids = 0;
    this.initAdapter();
  }
  /**
   * Initializes the `Adapter` for this nsp.
   * Run upon changing adapter by `Server#adapter`
   * in addition to the constructor.
   *
   * @api private
   */

  initAdapter(){
    this.adapter = new (this.server.adapter())(this);
  }
  /**
   * Sets up namespace middleware.
   * @params {Function} fn
   * @return {Namespace} self
   * @api public
   */
  use (fn){
    this.fns.push(fn);
    return this;
  }
  /**
   * Executes the middleware for an incoming client.
   *
   * @param {Socket} socket that will get added
   * @param {Function} fn last fn call in the middleware
   * @api private
   */
  run (socket, fn){
    const fns = this.fns.slice(0);
    if (!fns.length) return fn(null);
    const end = fns.length - 1;
    fns.map( cb, i => {
      cb(socket, (err)=> {
        if (err) return fn(err);
        if (i === end) return fn(null);
      });
    });
  }
  /**
   * Targets a room when emitting.
   *
   * @param {String} name
   * @return {Namespace} self
   * @api public
   */
  to (name){
    this.rooms = this.rooms || [];
    if (!this.rooms.includes(name)) this.rooms.push(name);
    return this;
  }
  in (name){
    return this.to.call(this, name);
  }

  /**
   * Adds a new client.
   * @api private
   * @param client
   * @param fn
   * @returns {{in: (function(*=)), ack: (function(Number)), onconnect: (function()), compress: (function(Boolean): Socket), request, ondisconnect: (function()), onevent: (function(Object)), disconnect: (function(Boolean): Socket), send: (function(): Socket), emit: (function(*=): Socket), onpacket: (function(Object)), onerror: (function(*=)), leaveAll: (function()), onclose: (function(String)), error: (function(Object)), to: (function(String): Socket), leave: (function(String, Function): Socket), write: (function()), join: (function(String, Function): Socket), packet: (function(Object, Object)), onack: (function(*)), buildHandshake: (function())}}
     */
  add (client, fn){
    //debug('adding socket to nsp %s', this.name);
    const socket = new Socket(this, client);
    this.run(socket, (err) => {
      process.nextTick( () => {
        if ('open' === client.conn.readyState) {
          if (err) return socket.error(err.data || err.message);

          // track socket
          this.sockets[socket.id] = socket;

          // it's paramount that the internal `onconnect` logic
          // fires before user-set events to prevent state order
          // violations (such as a disconnection before the connection
          // logic is complete)
          socket.onconnect();
          if (fn) fn();

          // fire user-set events
          this.emit('connect', socket);
          this.emit('connection', socket);
        }
      });
    });
    return socket;
  }

  /**
   * Removes a client. Called by each `Socket`.
   *
   * @api private
   */

  remove(socket){
    delete this.sockets[socket.id];
  }

  /**
   * Emits to all clients.
   *
   * @return {Namespace} self
   * @api public
   */

  emit(ev){
    const args = new Array(arguments.length);
    for(let i = 0; i < args.length; ++i) {
      args[i] = arguments[i];
    }
    if (EventsArr.includes(ev)){
      Emit.apply(this, args);
    } else {
      // set up packet object
      let parserType = parser.EVENT; // default
      if (hasBin(args)) { parserType = parser.BINARY_EVENT; } // binary

      const packet = { type: parserType, data: args };

      if ('function' === typeof args[args.length - 1]) {
        throw new Error('Callbacks are not supported when broadcasting');
      }

      this.adapter.broadcast(packet, {
        rooms: this.rooms,
        flags: this.flags
      });

      delete this.rooms;
      delete this.flags;
    }
    return this;
  }

  /**
   * Sends a `message` event to all clients.
   *
   * @return {Namespace} self
   * @api public
   */
  send(){
    const args = new Array(arguments.length);
    for(let i = 0; i < args.length; ++i) {
      args[i] = arguments[i];
    }
    args.unshift('message');
    this.emit.apply(this, args);
    return this;
  }
  write(){
    return this.send.call(this);
  }

  /**
   * Gets a list of clients.
   *
   * @return {Namespace} self
   * @api public
   */

  clients(fn){
    this.adapter.clients(this.rooms, fn);
    // delete rooms flag for scenario:
    // .in('room').clients() (GH-1978)
    delete this.rooms;
    return this;
  }
  /**
   * Sets the compress flag.
   *
   * @param {Boolean} compress if `true`, compresses the sending data
   * @return {Socket} self
   * @api public
   */

  compress(compress){
    this.flags = this.flags || {};
    this.flags.compress = compress;
    return this;
  }
};

/**
 * Apply flags from `Socket`.
 */

Flags.map( flag => {
  Namespace.prototype.__defineGetter__(flag, function(){
    this.flags = this.flags || {};
    this.flags[flag] = true;
    return this;
  });
});

Namespace.flags = Flags;
Namespace.events = EventsArr;

/**
 * Module exports.
 */

module.exports = Namespace;
