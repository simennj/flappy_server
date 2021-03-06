import {
  serve,
  ServerRequest,
} from "https://deno.land/std@0.92.0/http/server.ts";
import {
  acceptable,
  acceptWebSocket,
  WebSocket,
} from "https://deno.land/std@0.92.0/ws/mod.ts";

interface Room {
  host: WebSocket;
  clients: Map<string, WebSocket>;
}
const rooms = new Map<string, Room>();

async function handleHost(sock: WebSocket) {
  console.log("host connected!");
  const room = { host: sock, clients: new Map() };
  let roomName;
  try {
    for await (const ev of sock) {
      if (typeof ev === "string") {
        const data = JSON.parse(ev);
        if (data.room) {
          if (roomName) rooms.delete(roomName);
          roomName = data.room;
          rooms.set(data.room, room);
        }
        if (data.name) {
          await room.clients.get(data.name)?.send(ev);
        }
        if (data.remove) {
          room.clients.delete(data.remove);
        }
      }
    }
  } catch (err) {
    console.error(`failed to receive frame: ${err}`);

    if (!sock.isClosed) {
      await sock.close(1000).catch(console.error);
    }
  }
}

interface ClientState {
  name: string;
  hostSock: WebSocket;
}
async function handleClient(sock: WebSocket) {
  console.log("client connected!");
  try {
    const state = await getClientState(sock);
    for await (const ev of sock) {
      if (typeof ev === "string") {
        console.log("client:ws:Text", ev);
        const message = JSON.parse(ev);
        await state.hostSock.send(
          JSON.stringify({ ...message, name: state.name }),
        );
      }
    }
  } catch (err) {
    console.error(`failed to receive frame: ${err}`);

    if (!sock.isClosed) {
      await sock.close(1000).catch(console.error);
    }
  }
}
async function getClientState(sock: WebSocket): Promise<ClientState> {
  const sendError = (error: string) => sock.send(JSON.stringify({ error }));
  for await (const ev of sock) {
    if (!(typeof ev === "string")) {
      sendError("Not a string");
      continue;
    }
    try {
      const { room, name } = JSON.parse(ev);
      if (!room || !name) {
        sendError("room or name is missing");
        continue;
      }
      const roomState = rooms.get(room);
      if (!roomState) {
        sendError(`room with name ${room} was not found`);
        continue;
      }
      if (roomState.clients.has(name)) {
        sendError(`the name ${name} is taken`);
        continue;
      }
      roomState.clients.set(name, sock);
      return { name, hostSock: roomState.host };
    } catch (e) {
      if (e instanceof SyntaxError) {
        sendError("not valid json");
      }
      sendError("unknown error");
      continue;
    }
  }
  throw Error("Socket closed before clientState was received");
}
interface RequestEvent extends Event {
  request: ServerRequest;
  respondWith: (response: Response | Promise<Response>) => void;
}

const handleRequest = (req: ServerRequest) => {
  if (!acceptable(req)) return {
      body: '<html><head><meta charset="utf-8"></head><body>????</body></html>',
    };
  const { conn, r: bufReader, w: bufWriter, headers, url } = req;
    acceptWebSocket({ conn, bufReader, bufWriter, headers })
      .then(url.startsWith("/host") ? handleHost : handleClient)
      .catch(async (err) => {
        console.error(`failed to accept websocket: ${err}`);
        await req.respond({ status: 400 });
      });
};

if (!Deno.listen) {
  addEventListener("fetch", (e) => {
    const event = e as RequestEvent;
    const actualResponse = handleRequest(event.request);
    if (actualResponse) {
      const response = new Response(actualResponse.body, {
        headers: {"content-type": "text/html; charset=utf-8"}
      });
      event.respondWith(response);
    }
  });
} else if (import.meta.main) {
  const portString = Deno.args?.[0] || Deno.env.get("FLAPPY_PORT") || "8003";
  const port = parseInt(portString) || 8003;
  console.log(`websocket server is running on :${port}`);
  for await (const req of serve({ port })) {
    const response = handleRequest(req);
    if (response) req.respond(response);
  }
}
