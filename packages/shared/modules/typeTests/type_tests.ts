// type_tests.ts
import { createDuplexChannel } from '../frpBus'

/* ───────────────── SET-UP SOME PORTS ────────────────── */

/** every duplex channel looks like this:
 *
 *
 * DuplexChannel<Tx, Rx>
 *
 *              x: Port1 |  y: Port2
 * Stream "Tx":   send -> Tx -> receive
 * Stream "Rx":   receive <- Rx <- send
 *
 * As you can see Port 1 and to now consist of a "send" and "receive" function on duplex channels
 * the send and receive functions have datatypes a & b.
 *
 * So each duplex channel has two ports:   x: Port<a,b>,   y: Port<b,a>
 * /
 */

type Big = 'a' | 'b' | 'c' | 'd'
type Small = 'a' | 'b'

/**
 *                   x: Port1 |  y: Port2
 * Stream "Tx":   send ->    string  -> receive
 * Stream "Rx":   receive <- string  <- send
 */
const ss = createDuplexChannel<string>()
/**
 *                   x: Port1 |  y: Port2
 * Stream "Tx":   send ->    unknown  -> receive
 * Stream "Rx":   receive <- string  <- send
 */
const us = createDuplexChannel<unknown, string>()
/**
 *                   x: Port1 |  y: Port2
 * Stream "Tx":   send ->    unknown  -> receive
 * Stream "Rx":   receive <- unknown  <- send
 */
const uu = createDuplexChannel<unknown, unknown>()
/**
 *                   x: Port1 |  y: Port2
 * Stream "Tx":   send ->    Big  -> receive
 * Stream "Rx":   receive <- Small  <- send
 */
const bs = createDuplexChannel<Big, Small>()
const SS = createDuplexChannel<Small, Small>()
const bb = createDuplexChannel<Big, Big>()

/**************TESTING EXPLANATION */
// "connect" works by doing this:
//
//  A.receive(B.send)
//  B.receive(A.send)
//
// - type flow is from "receive" to "send"
// - this means ports "receivers" have to by compatible with port "send"
// OR:   "aRx extends bTx" in ts terms.
//
// this means, our information flow, when connection ports goes from "receive" to "send"

///////////////  TESTING SUBSETS///////////////
// two of the following for should have worked!
// should work (sending port is "Big")
// big <- small
// small -> small
bs.x.connect(SS.x)
bs.x.connect(SS.y)
SS.x.connect(bs.x)
SS.y.connect(bs.x)
// should not work (sending port is "small")
// small <- small
// big -> small
/*
bs.y.connect(SS.x)
bs.y.connect(SS.y)
SS.x.connect(bs.y)
SS.y.connect(bs.y)*/

// should work
// small -> big
// small <- small
SS.x.connect(SS.y)
// should work
// big -> small
// small <- big
bs.x.connect(bs.y)
// should not work
// big <- small
// small -> big
bs.x.connect(bs.x)
// should not work
// small <- small
// big -> small
//bs.y.connect(bs.y)

//should not work
// small -> big
// small <- big
//SS.y.connect(bb.x)

// should not work
// big -> small
// big <- small
//bb.y.connect(SS.x) // should error

// should work
// big <- big
// big -> small
bb.x.connect(bs.x)

///////////////  END TESTING SUBSETS///////////////

/* ────────────── SHOULD COMPILE (✓) ──────────────── */
// string -> string
// string <- string
ss.y.connect(ss.x) // same types: string ↔ string
// string -> unknown
// string <- string
ss.y.connect(us.x)
// unknown -> string
// string <- unknown
us.y.connect(us.x)
// unknown -> unknown
// string <- string
us.y.connect(us.x)
// unknown -> unknown
// unknown <- string
uu.y.connect(us.x)

/* ───────────── SHOULD FAIL (✗) ─────────────*/
/* un-comment to check if there is an error!
// string -> unknown
// string <- unknown*/
//ss.y.connect(uu.x)

/*
// unknown -> string
// string <- string*/
//us.y.connect(ss.x) // would try to send unknown into string receiver - should fail

/* ───────────── RUNTIME DEMO ───────────── */
ss.y.receive((m) => console.log('ab.b got', m))
us.y.receive((m) => console.log('aStringAny.b got', m))

ss.x.send('hello') // will flow to ab.b and aStringAny.b
