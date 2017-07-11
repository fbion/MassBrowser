/**
 * Created by milad on 7/11/17.
 */
process.env.APP_INTERFACE = 'commandline'

import { runTLSserver } from './net/TLSReceiver'
import { runOBFSserver } from './net/OBFSReceiver'
import { runHTTPListener } from './net/HttpListener'

import { pendMgr } from './net/PendingConnections'

var stun = require('vs-stun')
import ServerConnection from '~/api/wsAPI'
import ConnectivityConnection from '~/api/connectivityAPI'
import httpAPI from '~/api/httpAPI'
import KVStore from '~/utils/kvstore'
import * as errors from '~/utils/errors'
import StatusReporter from './net/StatusReporter'
import config from '~/utils/config'
import { initializeLogging } from '~/utils/log'

var stunserver = {
  host: 'stun.l.google.com',
  port: 19302
}

config.applicationInterface = 'commandline'
initializeLogging()
var isCalledbefore=false
export function bootRelay () {
  if (isCalledbefore) {
    return {}
  }
  isCalledbefore=true
  KVStore.get('relay', null)
    .then(relay => {
      if (relay) {
        return relay
      } else {
        console.log('Registering Relay')
        return httpAPI.registerRelay()
          .then(relay => {
            KVStore.set('relay', {id: relay.id, password: relay.password})
            return {id: relay.id, password: relay.password}
          })
      }
    })
    .then(relay => {
      console.log(`Authenticating Relay ${relay.id}`)
      return httpAPI.authenticate(relay.id, relay.password)
    })
    .then(() => {
      console.log('Connecting to Connectivity server')
      return ConnectivityConnection.connect()
        .then(data => {
          StatusReporter.startRoutine()
          StatusReporter.localip = data[0]
          StatusReporter.localport = data[1]
          StatusReporter.remoteport = data[3]
          StatusReporter.remoteip = data[2]
          if (config.relay.natEnabled) {
            return {
              localIP: StatusReporter.localip,
              localPort: StatusReporter.localport,
              remoteIP: StatusReporter.remoteip,
              remotePort: StatusReporter.remoteport
            }
          } else {
            return {
              localIP: '0.0.0.0',
              localPort: config.relay.port,
              remoteIP: StatusReporter.remoteip,
              remotePort: config.relay.port
            }
          }
        })
    })
    .then(address => {
      console.log('Connecting to WebSocket server')
      return ServerConnection.connect(httpAPI.getSessionID())
        .then(() => address)
    })
    .then((address) => {
      if (config.relay.domainfrontable) {
        console.log('Starting HTTP Server')
        return runHTTPListener(config.relay.domainfrontPort).then(() => address).then(() => {
          console.log('Reporting DomainFront to server')
          return ServerConnection.relayDomainFrontUp(config.relay.domain_name, config.relay.domainfrontPort)
        })
      }
    })
    .catch(err => {
      if (err instanceof errors.NetworkError) {
        console.error('Could not connect to the server')
      } else if (err instanceof errors.AuthenticationError) {
        console.error('Authentication failed with server')
      } else if (err instanceof errors.RequestError) {
        console.error('Error occured in request to server ' + err.message)
      } else if (err instanceof errors.ServerError) {
        console.error('There is a problem with the server, please try again later')
      } else {
        console.log('Unknown error occured: ' + err.toString())
      }
    })
}