import { serve } from "https://deno.land/std@0.92.0/http/server.ts";
import {
  acceptWebSocket,
  // isWebSocketCloseEvent,
  // isWebSocketPingEvent,
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
        // } else if (ev instanceof Uint8Array) {
        //   console.log("host:ws:Binary", ev);
        // } else if (isWebSocketPingEvent(ev)) {
        //   const [, body] = ev;
        //   console.log("host:ws:Ping", body);
        // } else if (isWebSocketCloseEvent(ev)) {
        //   const { code, reason } = ev;
        //   console.log("host:ws:Close", code, reason);
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
    // sock.send(JSON.stringify({clientName: state.name}));
    for await (const ev of sock) {
      if (typeof ev === "string") {
        console.log("client:ws:Text", ev);
        const message = JSON.parse(ev);
        await state.hostSock.send(
          JSON.stringify({ ...message, name: state.name }),
        );
        // } else if (ev instanceof Uint8Array) {
        //   console.log("client:ws:Binary", ev);
        // } else if (isWebSocketPingEvent(ev)) {
        //   const [, body] = ev;
        //   console.log("client:ws:Ping", body);
        // } else if (isWebSocketCloseEvent(ev)) {
        //   const { code, reason } = ev;
        //   console.log("client:ws:Close", code, reason);
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

if (import.meta.main) {
  /** websocket echo server */
  const port = Deno.args[0] || "8003";
  console.log(`websocket server is running on :${port}`);
  for await (const req of serve(`:${port}`)) {
    const { conn, r: bufReader, w: bufWriter, headers, url } = req;
    acceptWebSocket({
      conn,
      bufReader,
      bufWriter,
      headers,
    })
      .then(url.startsWith("/host") ? handleHost : handleClient)
      .catch(async (err) => {
        console.error(`failed to accept websocket: ${err}`);
        await req.respond({ status: 400 });
      });
  }
}
