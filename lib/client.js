"use strict";
/**
 * Module dependencies.
 */

const parser = require('socket.io-parser');

/**
 * Client constructor.
 *
 * @param {Server} server instance
 * @param {Socket} conn
 * @api private
 * @export
 * @type {{new(*, *): {remove: (function(*)), setup: (function()), connect: (function(String)), close: (function()), packet: (function(Object, Object=)), destroy: (function()), disconnect: (function()), onerror: (function(Object)), onclose: (function(String)), ondecoded: (function(*=)), ondata: (function(*=))}}}
 */
const Client = class Client{
  constructor(server, conn){
    this.server = server;
    this.conn = conn;
    this.encoder = new parser.Encoder();
    this.decoder = new parser.Decoder();
    this.id = conn.id;
    this.request = conn.request;
    this.setup();
    this.sockets = {};
    this.nsps = {};
    this.connectBuffer = [];
  }
  /**
   * Sets up event listeners.
   *
   * @api private
   */
  setup(){
    this.onclose = this.onclose.bind(this);
    this.ondata = this.ondata.bind(this);
    this.onerror = this.onerror.bind(this);
    this.ondecoded = this.ondecoded.bind(this);

    this.decoder.on('decoded', this.ondecoded);
    this.conn.on('data', this.ondata);
    this.conn.on('error', this.onerror);
    this.conn.on('close', this.onclose);
  }

  /**
   * Connects a client to a namespace.
   *
   * @param {String} name namespace
   * @api private
   */

  connect (name){
    const nsp = this.server.nsps[name];
    if (!nsp) {
      this.packet({ type: parser.ERROR, nsp: name, data : 'Invalid namespace'});
      return;
    }

    if ('/' !== name && !this.nsps['/']) {
      this.connectBuffer.push(name);
      return;
    }

    const socket = nsp.add(this, () => {
      this.sockets[socket.id] = socket;
      this.nsps[nsp.name] = socket;

      if ('/' === nsp.name && this.connectBuffer.length > 0) {
        this.connectBuffer.forEach(this.connect, this);
        this.connectBuffer = [];
      }
    });
  }
  /**
   * Disconnects from all namespaces and closes transport.
   *
   * @api private
   */

  disconnect(){
    Object.keys(this.sockets)
        .filter(id => this.sockets[id] )
        .map( id => this.sockets[id].disconnect() );
    this.sockets = {};
    this.close();
  }
  /**
   * Removes a socket. Called by each `Socket`.
   *
   * @api private
   */
  remove (socket){
    if (this.sockets.hasOwnProperty(socket.id)) {
      const nsp = this.sockets[socket.id].nsp.name;
      delete this.sockets[socket.id];
      delete this.nsps[nsp];
    }
  }

  /**
   * Closes the underlying connection.
   *
   * @api private
   */
  close (){
    if ('open' === this.conn.readyState) {
      this.conn.close();
      this.onclose('forced server close');
    }
  }

  /**
   * Writes a packet to the transport.
   *
   * @param {Object} packet object
   * @param {Object} opts
   * @api private
   */
  packet (packet, opts = {}){
    // this writes to the actual connection
    const writeToEngine = (encodedPackets) => {
      if (opts.volatile && !this.conn.transport.writable) return;
      for (let i = 0; i < encodedPackets.length; i++) {
        this.conn.write(encodedPackets[i], { compress: opts.compress });
      }
    };

    if ('open' === this.conn.readyState) {
      if (!opts.preEncoded) { // not broadcasting, need to encode
        this.encoder.encode(packet, (encodedPackets) => { // encode, then write results to engine
          writeToEngine(encodedPackets);
        });
      } else { // a broadcast pre-encodes a packet
        writeToEngine(packet);
      }
    }
  }
  /**
   * Called with incoming transport data.
   *
   * @api private
   */
  ondata (data){
    // try/catch is needed for protocol violations (GH-1880)
    try {
      this.decoder.add(data);
    } catch(e) {
      this.onerror(e);
    }
  }
  /**
   * Called when parser fully decodes a packet.
   *
   * @api private
   */

  ondecoded (packet) {
    if (parser.CONNECT === packet.type) {
      this.connect(packet.nsp);
    } else {
      const socket = this.nsps[packet.nsp];
      if (socket) {
        socket.onpacket(packet);
      }
    }
  }

  /**
   * Handles an error.
   *
   * @param {Object} err object
   * @api private
   */

  onerror (err){
    Object.keys(this.sockets)
        .filter(id => this.sockets[id])
        .map(id => this.sockets[id].onerror(err) );

    this.onclose('client error');
  }
  /**
   * Called upon transport close.
   *
   * @param {String} reason
   * @api private
   */

  onclose (reason){
    // ignore a potential subsequent `close` event
    this.destroy();
    // `nsps` and `sockets` are cleaned up seamlessly
    Object.keys(this.sockets)
        .filter( id => this.sockets[id] )
        .map( id => this.sockets[id].onclose(reason) );

    this.sockets = {};
    this.decoder.destroy(); // clean up decoder
  }
  /**
   * Cleans up event listeners.
   *
   * @api private
   */

  destroy(){
    this.conn.removeListener('data', this.ondata);
    this.conn.removeListener('error', this.onerror);
    this.conn.removeListener('close', this.onclose);
    this.decoder.removeListener('decoded', this.ondecoded);
  }
}

/**
 * Module exports.
 */

module.exports = Client;
