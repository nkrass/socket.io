"use strict";
/**
 * Module dependencies.
 */

const Emitter = require('events').EventEmitter;
const parser = require('socket.io-parser');
const url = require('url');
const hasBin = require('has-binary');

/**
 * Blacklisted events.
 *
 * @api public
 */

const Events = [
  'error',
  'connect',
  'disconnect',
  'newListener',
  'removeListener'
];

/**
 * Flags.
 *
 * @api private
 */

const Flags = [
  'json',
  'volatile',
  'broadcast'
];

/**
 * `EventEmitter#emit` reference.
 */

const Emit = Emitter.prototype.emit;

/**
 * Interface to a `Client` for a given `Namespace`.
 * @constructor
 * @param {Namespace} nsp
 * @param {Client} client
 * @api public
 * @type {{new(*, *): {in: (function(*=)), ack: (function(Number)), onconnect: (function()), compress: (function(Boolean): Socket), request, ondisconnect: (function()), onevent: (function(Object)), disconnect: (function(Boolean): Socket), send: (function(): Socket), emit: (function(*=): Socket), onpacket: (function(Object)), onerror: (function(*=)), leaveAll: (function()), onclose: (function(String)), error: (function(Object)), to: (function(String): Socket), leave: (function(String, Function): Socket), write: (function()), join: (function(String, Function): Socket), packet: (function(Object, Object)), onack: (function(*)), buildHandshake: (function())}}}
 * @export
 */
const Socket = class extends Emitter {
  constructor(nsp, client) {
    super();
    this.nsp = nsp;
    this.server = nsp.server;
    this.adapter = this.nsp.adapter;
    this.id = nsp.name + '#' + client.id;
    this.client = client;
    this.conn = client.conn;
    this.rooms = {};
    this.acks = {};
    this.connected = true;
    this.disconnected = false;
    this.handshake = this.buildHandshake();
  }

  /**
   * `request` engine.io shortcut.
   *
   * @api public
   */

  get request (){
    return this.conn.request;
  }
  /**
   * Builds the `handshake` BC object
   *
   * @api private
   */
  buildHandshake(){
    return {
      headers: this.request.headers,
      time: (new Date) + '',
      address: this.conn.remoteAddress,
      xdomain: !!this.request.headers.origin,
      secure: !!this.request.connection.encrypted,
      issued: +(new Date),
      url: this.request.url,
      query: url.parse(this.request.url, true).query || {}
    };
  }
  /**
   * Emits to this client.
   *
   * @return {Socket}
   * @api public
   */
  emit (ev){
    if (Events.includes(ev)) {
      Emit.apply(this, arguments);
    } else {
      var args = Array.prototype.slice.call(arguments);
      var packet = {};
      packet.type = hasBin(args) ? parser.BINARY_EVENT : parser.EVENT;
      packet.data = args;
      var flags = this.flags || {};

      // access last argument to see if it's an ACK callback
      if ('function' === typeof args[args.length - 1]) {
        if (this._rooms || flags.broadcast) {
          throw new Error('Callbacks are not supported when broadcasting');
        }
        this.acks[this.nsp.ids] = args.pop();
        packet.id = this.nsp.ids++;
      }

      if (this._rooms || flags.broadcast) {
        this.adapter.broadcast(packet, {
          except: [this.id],
          rooms: this._rooms,
          flags: flags
        });
      } else {
        // dispatch packet
        this.packet(packet, {
          volatile: flags.volatile,
          compress: flags.compress
        });
      }

      // reset flags
      delete this._rooms;
      delete this.flags;
    }
    return this;
  }
  /**
   * Targets a room when broadcasting.
   *
   * @param {String} name
   * @return {Socket} self
   * @api public
   */
  to (name){
    this._rooms = this._rooms || [];
    if (!this._rooms.includes(name)) this._rooms.push(name);
    return this;
  }
  in (name) {
    return this.to.call(this, name);
  }

  /**
   * Sends a `message` event.
   *
   * @return {Socket}
   * @api public
   */

  send(){
    const args = Array.prototype.slice.call(arguments);
    args.unshift('message');
    this.emit.apply(this, args);
    return this;
  }
  write(){
    return this.send.call(this, arguments)
  }

  /**
   * Writes a packet.
   *
   * @param {Object} packet object
   * @param {Object} opts options
   * @api private
   */

  packet (packet, opts){
    packet.nsp = this.nsp.name;
    opts = opts || {};
    opts.compress = opts.compress || false;
    this.client.packet(packet, opts);
  }

  /**
   * Joins a room.
   *
   * @param {String} room
   * @param {Function} fn optional, callback
   * @return {Socket}
   * @api private
   */

  join (room, fn){
    if (Object.keys(this.rooms).includes(room)){
      fn && fn(null);
      return this;
    }
    this.adapter.add(this.id, room, (err) => {
      if (err) return fn && fn(err);
      this.rooms[room] = room;
      fn && fn(null);
    });
    return this;
  }
  /**
   * Leaves a room.
   *
   * @param {String} room
   * @param {Function} fn optional, callback
   * @return {Socket}
   * @api private
   */

  leave(room, fn){
    this.adapter.del(this.id, room, (err) => {
      if (err) return fn && fn(err);
      delete this.rooms[room];
      fn && fn(null);
    });
    return this;
  }

  /**
   * Leave all rooms.
   *
   * @api private
   */

  leaveAll (){
    this.adapter.delAll(this.id);
    this.rooms = {};
  }

  /**
   * Called by `Namespace` upon succesful
   * middleware execution (ie: authorization).
   *
   * @api private
   */

  onconnect(){
    this.nsp.connected[this.id] = this;
    this.join(this.id);
    this.packet({ type: parser.CONNECT });
  }
  /**
   * Called with each packet. Called by `Client`.
   *
   * @param {Object} packet
   * @api private
   */

  onpacket (packet){
    switch (packet.type) {
      case parser.EVENT:
        this.onevent(packet);
        break;

      case parser.BINARY_EVENT:
        this.onevent(packet);
        break;

      case parser.ACK:
        this.onack(packet);
        break;

      case parser.BINARY_ACK:
        this.onack(packet);
        break;

      case parser.DISCONNECT:
        this.ondisconnect();
        break;

      case parser.ERROR:
        this.emit('error', packet.data);
    }
  }
  /**
   * Called upon event packet.
   *
   * @param {Object} packet object
   * @api private
   */

  onevent (packet){
    const args = packet.data || [];

    if (null !== packet.id) {
      args.push(this.ack(packet.id));
    }
    Emit.apply(this, args);
  }

  /**
   * Produces an ack callback to emit with an event.
   *
   * @param {Number} id packet id
   * @api private
   */

  ack (id){
    let sent = false;
    return () => {
      // prevent double callbacks
      if (sent) return;
      const args = Array.prototype.slice.call(arguments);
      const type = hasBin(args) ? parser.BINARY_ACK : parser.ACK;
      this.packet({
        id: id,
        type: type,
        data: args
      });

      sent = true;
    };
  }
  /**
   * Called upon ack packet.
   *
   * @api private
   */
  onack (packet){
    const ack = this.acks[packet.id];
    if ('function' === typeof ack) {
      ack.apply(this, packet.data);
      delete this.acks[packet.id];
    }
  }

  /**
   * Called upon client disconnect packet.
   *
   * @api private
   */

  ondisconnect (){
    this.onclose('client namespace disconnect');
  }

  /**
   * Handles a client error.
   *
   * @api private
   */

  onerror (err){
    if (this.listeners('error').length) {
      this.emit('error', err);
    } else {
      console.error('Missing error handler on `socket`.');
      console.error(err.stack);
    }
  }

  /**
   * Called upon closing. Called by `Client`.
   *
   * @param {String} reason
   * @throw {Error} optional error object
   * @api private
   */

  onclose(reason){
    if (!this.connected) return this;
    this.leaveAll();
    this.nsp.remove(this);
    this.client.remove(this);
    this.connected = false;
    this.disconnected = true;
    delete this.nsp.connected[this.id];
    this.emit('disconnect', reason);
  }

  /**
   * Produces an `error` packet.
   *
   * @param {Object} err error object
   * @api private
   */

  error (err){
    this.packet({ type: parser.ERROR, data: err });
  }

  /**
   * Disconnects this client.
   *
   * @param {Boolean} close if `true`, closes the underlying connection
   * @return {Socket}
   * @api public
   */

  disconnect (close){
    if (!this.connected) return this;
    if (close) {
      this.client.disconnect();
    } else {
      this.packet({ type: parser.DISCONNECT });
      this.onclose('server namespace disconnect');
    }
    return this;
  }

  /**
   * Sets the compress flag.
   *
   * @param {Boolean} compress if `true`, compresses the sending data
   * @return {Socket} 
   * @api public
   */

  compress (compress){
    this.flags = this.flags || {};
    this.flags.compress = compress;
    return this;
  }
}

/**
 * Apply flags from `Socket`.
 */

Flags.map( flag => {
  Socket.prototype.__defineGetter__(flag, function(){
    this.flags = this.flags || {};
    this.flags[flag] = true;
    return this;
  });
});

/**
 * Module exports.
 */
Socket.flags = Flags;
Socket.events = Events;

module.exports = Socket;
