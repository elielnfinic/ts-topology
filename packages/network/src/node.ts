import {
	type GossipsubEvents,
	type GossipsubMessage,
	gossipsub,
} from "@chainsafe/libp2p-gossipsub";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { autoNAT } from "@libp2p/autonat";
import { bootstrap } from "@libp2p/bootstrap";
import {
	circuitRelayServer,
	circuitRelayTransport,
} from "@libp2p/circuit-relay-v2";
import { generateKeyPairFromSeed } from "@libp2p/crypto/keys";
import { dcutr } from "@libp2p/dcutr";
import { devToolsMetrics } from "@libp2p/devtools-metrics";
import { identify } from "@libp2p/identify";
import type {
	EventCallback,
	PubSub,
	Stream,
	StreamHandler,
} from "@libp2p/interface";
import { pubsubPeerDiscovery } from "@libp2p/pubsub-peer-discovery";
import { webRTC, webRTCDirect } from "@libp2p/webrtc";
import { webSockets } from "@libp2p/websockets";
import { webTransport } from "@libp2p/webtransport";
import { kadDHT, type KadDHT } from "@libp2p/kad-dht";
import { multiaddr } from "@multiformats/multiaddr";
import { type Libp2p, createLibp2p } from "libp2p";
import { fromString as uint8ArrayFromString } from "uint8arrays/from-string";
import { toString as uint8ArrayToString } from "uint8arrays/to-string";
import { Message } from "./proto/messages_pb.js";
import { uint8ArrayToStream } from "./stream.js";

export * from "./stream.js";

// snake_casing to match the JSON config
export interface TopologyNetworkNodeConfig {
	addresses?: string[];
	bootstrap?: boolean;
	bootstrap_peers?: string[];
	browser_metrics?: boolean;
	private_key_seed?: string;
}

export class TopologyNetworkNode {
	private _config?: TopologyNetworkNodeConfig;
	private _node?: Libp2p;
	private _pubsub?: PubSub<GossipsubEvents>;
	private _dht?: KadDHT;

	peerId = "";

	constructor(config?: TopologyNetworkNodeConfig) {
		this._config = config;
	}

	async start() {
		let privateKey = undefined;
		if (this._config?.private_key_seed) {
			const tmp = this._config.private_key_seed.padEnd(32, "0");
			privateKey = await generateKeyPairFromSeed(
				"Ed25519",
				uint8ArrayFromString(tmp),
			);
		}

		this._node = await createLibp2p({
			privateKey,
			addresses: {
				listen: this._config?.addresses ? this._config.addresses : ["/webrtc"],
			},
			connectionEncrypters: [noise()],
			connectionGater: {
				denyDialMultiaddr: () => {
					return false;
				},
			},
			metrics: this._config?.browser_metrics ? devToolsMetrics() : undefined,
			peerDiscovery: [
				pubsubPeerDiscovery({
					interval: 10_000,
					topics: ["topology::discovery"],
				}),
				bootstrap({
					list: this._config?.bootstrap_peers
						? this._config.bootstrap_peers
						: [
								"/dns4/relay.droak.sh/tcp/443/wss/p2p/Qma3GsJmB47xYuyahPZPSadh1avvxfyYQwk8R3UnFrQ6aP",
							],
				}),
			],
			services: {
				autonat: autoNAT(),
				dcutr: dcutr(),
				identify: identify(),
				pubsub: gossipsub(),
				dht: kadDHT(),
			},
			streamMuxers: [yamux()],
			transports: [
				circuitRelayTransport({
					discoverRelays: 2,
					reservationConcurrency: 1,
				}),
				webRTC(),
				webRTCDirect(),
				webSockets(),
				webTransport(),
			],
		});

		if (this._config?.bootstrap)
			this._node.services.relay = circuitRelayServer();

		if (!this._config?.bootstrap) {
			for (const addr of this._config?.bootstrap_peers || []) {
				this._node.dial(multiaddr(addr));
			}
		}

		this._pubsub = this._node.services.pubsub as PubSub<GossipsubEvents>;
		this.peerId = this._node.peerId.toString();
		this._dht = this._node.services.dht as KadDHT;

		console.log(
			"topology::network::start: Successfuly started topology network w/ peer_id",
			this.peerId,
		);

		this._node.addEventListener("peer:connect", (e) =>
			console.log("::start::peer::connect", e.detail),
		);
		this._node.addEventListener("peer:discovery", (e) => {
			// current bug in v11.0.0 requires manual dial (https://github.com/libp2p/js-libp2p-pubsub-peer-discovery/issues/149)
			for (const ma of e.detail.multiaddrs) {
				this._node?.dial(ma);
			}
			console.log("::start::peer::discovery", e.detail);
		});
		this._node.addEventListener("peer:identify", (e) =>
			console.log("::start::peer::identify", e.detail),
		);
	}

	subscribe(topic: string) {
		if (!this._node) {
			console.error(
				"topology::network::subscribe: Node not initialized, please run .start()",
			);
			return;
		}

		try {
			this.announcePeerOnDHT(topic, this.peerId + "-" + Date.now().toString());	
			console.log("topology::network::subscribe: Announced peer on DHT", topic, this.peerId);
			// this._pubsub?.subscribe(topic);
			// this._pubsub?.getPeers();
			console.log(
				"topology::network::subscribe: Successfuly subscribed the topic",
				topic,
			);
		} catch (e) {
			console.error("topology::network::subscribe:", e);
		}
	}

	unsubscribe(topic: string) {
		if (!this._node) {
			console.error(
				"topology::network::unsubscribe: Node not initialized, please run .start()",
			);
			return;
		}

		try {
			// this._pubsub?.unsubscribe(topic);
			this.removePeerFromDHT(topic, this.peerId);
			console.log(
				"topology::network::unsubscribe: Successfuly unsubscribed the topic",
				topic,
			);
		} catch (e) {
			console.error("topology::network::unsubscribe:", e);
		}
	}

	getAllPeers() {
		const peers = this._node?.getPeers();
		if (!peers) return [];
		return peers.map((peer) => peer.toString());
	}

	// getGroupPeers(group: string) {
	// 	const peers = this._pubsub?.getSubscribers(group);
	// 	if (!peers) return [];
	// 	return peers.map((peer) => peer.toString());
	// }

	async getGroupPeers(group: string) { // I should not use await here 
		const peers = this._pubsub?.getSubscribers(group);
		if (!peers) return [];
		return peers.map((peer) => peer.toString());
	}

	async getRoomPeers(room: string): Promise<string[]> {
		const peers = await this.getPeersOnTopicFromDHT(room);
		if (!peers) return [];
		return Array.from(peers);
	}

	async broadcastMessage(topic: string, message: Message) {
		try {
			const messageBuffer = Message.encode(message).finish();
			await this._pubsub?.publish(topic, messageBuffer);

			console.log(
				"topology::network::broadcastMessage: Successfuly broadcasted message to topic",
				topic,
			);
		} catch (e) {
			console.error("topology::network::broadcastMessage:", e);
		}
	}

	async sendMessage(peerId: string, protocols: string[], message: Message) {
		try {
			const connection = await this._node?.dial([multiaddr(`/p2p/${peerId}`)]);
			const stream = <Stream>await connection?.newStream(protocols);
			const messageBuffer = Message.encode(message).finish();
			uint8ArrayToStream(stream, messageBuffer);
		} catch (e) {
			console.error("topology::network::sendMessage:", e);
		}
	}

	async sendGroupMessageRandomPeer(
		group: string,
		protocols: string[],
		message: Message,
	) {
		try {
			const peers = this._pubsub?.getSubscribers(group);
			// const peers = Array.from(await this.getPeersOnTopicFromDHT(group));
			if (!peers || peers.length === 0) throw Error("Topic wo/ peers");
			const peerId = peers[Math.floor(Math.random() * peers.length)];

			const connection = await this._node?.dial(peerId);
			const stream: Stream = (await connection?.newStream(protocols)) as Stream;
			const messageBuffer = Message.encode(message).finish();
			uint8ArrayToStream(stream, messageBuffer);
		} catch (e) {
			console.error("topology::network::sendMessageRandomTopicPeer:", e);
		}
	}

	addGroupMessageHandler(
		group: string,
		handler: EventCallback<CustomEvent<GossipsubMessage>>,
	) {
		this._pubsub?.addEventListener("gossipsub:message", (e) => {
			if (group && e.detail.msg.topic !== group) return;
			handler(e);
		});
	}

	addMessageHandler(protocol: string | string[], handler: StreamHandler) {
		this._node?.handle(protocol, handler);
	}

	/**
	 *
	 * @param key  The key to search for
	 * @param value  The value to search for
	 * @returns The value `true` if the data was put on the DHT successfully, `false` if not and undefined if the DHT is not initialized
	 */
	private async putDataOnDHT(
		key: Uint8Array,
		value: Uint8Array,
	): Promise<boolean> {
		if (!this._dht) {
			console.error(
				"topology::network::topic::discovery: DHT not initialized. Please run .start()",
			);
			return false;
		}

		try {
			await this._dht?.put(key, value);
			console.log(
				"topology::network::topic::discovery: Successfully saved on DHT",
			);
			return true;
		} catch (e) {
			console.error(
				"topology::network::topic::discovery: Error storing data on DHT : ",
				e,
			);
			return false;
		}
	}


	/*
	 * Announce the peer on the DHT
	 * @param topic The topic to announce the peer on
	 * @param peer_id The peer to announce
	 * @returns nothing
	 * */

	async announcePeerOnDHT(topic: string, peer_id: string): Promise<void> {
		const peersSet = await this.getPeersOnTopicFromDHT(topic);
		console.log("PRE-LIST peers on topic", topic, peersSet);
		peersSet.push(peer_id);
		console.log("NEW-LIST peers on topic", topic, peersSet);
		const newPeers = JSON.stringify(Array.from(peersSet));
		const newPeersUint8 = uint8ArrayFromString(newPeers);
		const uint8Topic = uint8ArrayFromString(topic);
		await this.putDataOnDHT(uint8Topic, newPeersUint8);
	}

	/*
	 * Remove the peer from the DHT
	 * @param topic The topic to remove the peer from
	 * @param peer_id The peer to remove
	 * @returns nothing
	 * */
	private async removePeerFromDHT(
		topic: string,
		peerId: string,
	): Promise<void> {
		const peersSet = await this.getPeersOnTopicFromDHT(topic);
		// peersSet.delete(peerId);
		const newPeers = JSON.stringify(Array.from(peersSet));
		const newPeersUint8 = uint8ArrayFromString(newPeers);
		const uint8Topic = uint8ArrayFromString(topic);
		await this.putDataOnDHT(uint8Topic, newPeersUint8);
	}

	/*
	 * Get the peers on a topic from the DHT
	 * @param topic The topic to get the peers from
	 * @returns A set of PeerId
	 * */
	async getPeersOnTopicFromDHT(topic: string): Promise<string[]> {
		const uint8Topic = uint8ArrayFromString(topic);
		const peersOnTopic = this._dht?.get(uint8Topic);
		let peersSet : string[] = [];// = new Set<string>();
		console.log("GETTING peers on topic", topic);
		if (peersOnTopic) {
			console.log("FOUND peers on topic", topic);
			for await (const evt of peersOnTopic) {
				if (evt.name === "VALUE") {
					const uint8Peers = evt.value;
					const peersArray = JSON.parse(uint8ArrayToString(uint8Peers));
					// peersSet = new Set(peersArray);
					peersSet = peersArray;
					console.log("LISTED peers on topic", topic, peersSet);
				}
			}
		}
		console.log("RETURNING peers on topic", topic, peersSet);
		return peersSet;
	}
}
