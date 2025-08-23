// type_tests.ts
import { createDuplexChannel } from '../../../../src/modules/frpBus'
import type { TaskyonMessage } from '../../../../src/modules/taskyon/apiTypes'

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

type Big = 'a' | 'b' | 'c'
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
const l1 = createDuplexChannel<Big, Small>()
/**
 *                   x: Port1 |  y: Port2
 * Stream "Tx":   send ->    Small  -> receive
 * Stream "Rx":   receive <- Small  <- send
 */
const l2 = createDuplexChannel<Small, Small>()

// should work
// small -> small
// big <- small
l1.x.connect(l2.x)
// should work
// big -> small
// small <- big
l1.x.connect(l1.y)
// should not work
// big -> small
// small <- big
l1.x.connect(l1.x)
// should not work
// small -> small
// big <- small
l1.y.connect(l2.y)

const big = createDuplexChannel<Big, Big>()
const small = createDuplexChannel<Small, Small>()

//should not work
// small -> big
// small <- big
small.y.connect(big.x)

// should not work
// big -> small
// big <- small
big.y.connect(small.x) // should error

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
ss.y.connect(uu.x)

/*
// unknown -> string
// string <- string*/
us.y.connect(ss.x) // would try to send unknown into string receiver - should fail

/* ───────────── RUNTIME DEMO ───────────── */
ss.y.receive((m) => console.log('ab.b got', m))
us.y.receive((m) => console.log('aStringAny.b got', m))

ss.x.send('hello') // will flow to ab.b and aStringAny.b

const A = createDuplexChannel<TaskyonMessage, unknown>()
const B = createDuplexChannel<TaskyonMessage, unknown>()

A.y.connect(B.x)
