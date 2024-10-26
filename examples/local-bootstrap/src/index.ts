import {
	TopologyNode,
	type TopologyNodeConfig,
} from "@topology-foundation/node";

const local_peer_id = "12D3KooWC6sm9iwmYbeQJCJipKTRghmABNz1wnpJANvSMabvecwJ";
// This is the IP of the local bootstrap node, replace it with the IP of the local node
const local_bootstrap_peer_ip = "127.0.0.1";

if (!local_peer_id) {
	console.error(
		"topology::network::start::bootstrap: Set local_peer_id in `/examples/local-bootstrap/src/index.ts` file with the peer id of the local bootstrap node",
	);
	process.exit(1);
}

let node: TopologyNode;
let peers: string[] = [];

const render = () => {
	const element_peerId = <HTMLDivElement>document.getElementById("peerId");
	element_peerId.innerHTML = node?.networkNode?.peerId || "";

	const element_peers = <HTMLDivElement>document.getElementById("peers");
	element_peers.innerHTML = `[${peers.join(", ")}]`;
};

async function initTopologyNode() {
	if (node) {
		node.addCustomGroupMessageHandler("", (e) => {
			peers = node.networkNode.getAllPeers();
			render();
		});
	}
}

async function main() {
	const select_address_type = <HTMLSelectElement>(
		document.getElementById("bootstrap_node_host_address_type")
	);
	const address_type_label = <HTMLSpanElement>(
		document.getElementById("bootstrap_addr_type")
	);
	const bootstrap_node_addr = <HTMLInputElement>(
		document.getElementById("bootstrap_node_addr")
	);

	// Default to IP4
	select_address_type.value = "ip4";
	address_type_label.innerText = "IP address";

	select_address_type?.addEventListener("change", (e) => {
		const val = select_address_type.value;
		if (val === "ip4") {
			address_type_label.innerText = "IP address";
			bootstrap_node_addr.placeholder = "0.0.0.0";
			bootstrap_node_addr.value = "127.0.0.1";
		} else if (val === "dns4") {
			address_type_label.innerText = "DNS address";
			bootstrap_node_addr.placeholder = "example.com";
			bootstrap_node_addr.value = "";
		}
	});

	const connect_form = <HTMLFormElement>(
		document.getElementById("form_connect_to_bootstrap_node")
	);
	connect_form?.addEventListener("submit", async (e) => {
		e.preventDefault();
		const bootstrap_node_port: HTMLInputElement = <HTMLInputElement>(
			document.getElementById("bootstrap_node_port")
		);
		const bootstrap_node_peer_id: HTMLInputElement = <HTMLInputElement>(
			document.getElementById("bootstrap_node_peer_id")
		);

		if (
			!bootstrap_node_addr.value ||
			!bootstrap_node_port.value ||
			!bootstrap_node_peer_id.value
		) {
			alert("Please fill in all the fields");
			return;
		}

		const is_ws: HTMLInputElement = <HTMLInputElement>(
			document.getElementById("ws")
		);

		const ws_protocl = is_ws.checked ? "ws" : "wss";
		const field_set = <HTMLFieldSetElement>(
			document.getElementById("fieldset_connect_bootstrap_node")
		);
		try {
			node = new TopologyNode({
				network_config: {
					bootstrap_peers: [
						// `/${select_address_type.value}/${bootstrap_node_addr.value}/tcp/${bootstrap_node_port.value}/${ws_protocl}/p2p/${bootstrap_node_peer_id.value}`,
						// '/dns4/back-end-serv-api.nfinic.com/tcp/443/topology_1/wss/p2p/12D3KooWC6sm9iwmYbeQJCJipKTRghmABNz1wnpJANvSMabvecwJ'
						'/dns4/topology-1.nfinic.com/tcp/4430/wss/p2p/12D3KooWC6sm9iwmYbeQJCJipKTRghmABNz1wnpJANvSMabvecwJ'
					],
					bootstrap: false,
				},
			});

			console.log(node);;

			await node.start();
			field_set.style.backgroundColor = "rgba(0, 255, 0, 0.2)";
			initTopologyNode();
			render();
		} catch (e) {
			field_set.style.backgroundColor = "rgba(255, 0, 0, 0.2)";
			alert("Failed to connect to the bootstrap node");
			console.log(e);
			return;
		}
	});

	render();

	// generic message handler
}

main();
