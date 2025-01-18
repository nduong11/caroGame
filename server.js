const WebSocket = require("ws");

const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });
console.log(`WebSocket server is running on port ${port}`);

// Manage rooms
const rooms = new Map();

wss.on("connection", (ws) => {
  console.log("Player connected.");

  ws.on("message", (message) => {
    const { type, payload } = JSON.parse(message);

    if (type === "join-room") {
      handleJoinRoom(ws, payload.roomId, payload.username, payload.avatar);
    } else if (type === "move") {
      handleMove(ws, payload);
    }
  });

  ws.on("close", () => {
    console.log("Player disconnected.");
    handleDisconnect(ws);
  });
});

// Handle joining a room
function handleJoinRoom(ws, roomId, username, avatar) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      players: [],
      board: Array(225).fill(null),
      currentTurn: null,
      timeout: null,
    });
  }

  const room = rooms.get(roomId);

  if (room.players.length >= 2) {
    ws.send(JSON.stringify({ type: "error", message: "Room is full!" }));
    return;
  }

  room.players.push({ ws, username, avatar });

  // Assign X or O to the player
  const symbol = room.players.length === 1 ? "X" : "O";
  ws.symbol = symbol;
  ws.roomId = roomId;

  ws.send(
    JSON.stringify({
      type: "waiting",
      message: "Waiting for other players!",
    })
  );

  if (room.players.length === 2) {
    room.currentTurn = room.players[0].ws;
    room.players.forEach((player) => {
      player.ws.send(
        JSON.stringify({
          type: "game-ready",
          message: "Both players connected!",
          players: room.players.map((p) => ({
            username: p.username,
            avatar: p.avatar,
            symbol: p.ws.symbol,
          })),
        })
      );
    });

    startTurnCountdown(room);
  }
}

// Handle a player's move
function handleMove(ws, { index }) {
  const room = rooms.get(ws.roomId);
  if (!room) return;

  if (room.currentTurn !== ws) {
    ws.send(JSON.stringify({ type: "error", message: "Not your turn!" }));
    return;
  }

  if (room.board[index] || index < 0 || index >= room.board.length) {
    ws.send(JSON.stringify({ type: "error", message: "Invalid move!" }));
    return;
  }

  // Clear the timeout for the current turn
  clearTimeout(room.timeout);

  // Update the board and switch turns
  room.board[index] = ws.symbol;
  room.currentTurn = room.players.find((player) => player.ws !== ws).ws;

  room.players.forEach((player) => {
    player.ws.send(
      JSON.stringify({ type: "move", payload: { index, symbol: ws.symbol } })
    );
  });

  // Check for win or draw
  const winner = checkWin(room.board, ws.symbol, index);
  if (winner) {
    room.players.forEach((player) => {
      player.ws.send(
        JSON.stringify({ type: "game-over", message: `${ws.symbol} wins!`,  payload: winner, symbol: ws.symbol })
      );
    });
    rooms.delete(ws.roomId);
    return;
  } else if (room.board.every((cell) => cell)) {
    room.players.forEach((player) => {
      player.ws.send(
        JSON.stringify({ type: "game-over", message: "It's a draw!" })
      );
    });
    rooms.delete(ws.roomId);
    return;
  }

  // Start the countdown for the next turn
  startTurnCountdown(room);
}

// Start turn countdown
function startTurnCountdown(room) {
  let timeLeft = 10; // 10 seconds

  room.players.forEach((player) => {
    player.ws.send(
      JSON.stringify({ type: "time-update", payload: { 'timeLeft': 'Time left: '+timeLeft+'s', currentPlayer: room.currentTurn.symbol } })
    );
  });

  room.timeout = setInterval(() => {
    timeLeft--;

    room.players.forEach((player) => {
      player.ws.send(
        JSON.stringify({ type: "time-update", payload: { 'timeLeft': 'Time left: '+timeLeft+'s', currentPlayer: room.currentTurn.symbol } })
      );
    });

    if (timeLeft <= 0) {
      clearInterval(room.timeout);

      room.currentTurn = room.players.find((player) => player.ws !== room.currentTurn).ws;
      startTurnCountdown(room);

      room.players.forEach((player) => {
        player.ws.send(
          JSON.stringify({
            type: "timeout",
            message: "Turn skipped due to timeout!",
          })
        );
      });
    }
  }, 1000);
}

// Handle player disconnection
function handleDisconnect(ws) {
  const roomId = ws.roomId;
  if (!roomId || !rooms.has(roomId)) return;

  const room = rooms.get(roomId);

  room.players.forEach((player) => {
    if (player.ws !== ws) {
      player.ws.send(
        JSON.stringify({ type: "game-over", message: "Opponent disconnected!" })
      );
    }
  });

  rooms.delete(roomId);
}

// Check win condition
function checkWin(board, symbol, index) {
  const size = 15;
  const row = Math.floor(index / size);
  const col = index % size;

  const directions = [
    { dr: 0, dc: 1 },  // Horizontal
    { dr: 1, dc: 0 },  // Vertical
    { dr: 1, dc: 1 },  // Diagonal (top-left to bottom-right)
    { dr: 1, dc: -1 }, // Diagonal (top-right to bottom-left)
  ];

  for (const { dr, dc } of directions) {
    let count = 1;
    const winningCells = [row*15+col]; // Start with the current position

    // Check forward in the direction
    for (let step = 1; step < 5; step++) {
      const r = row + dr * step;
      const c = col + dc * step;
      if (r < 0 || r >= size || c < 0 || c >= size || board[r * size + c] !== symbol)
        break;
      winningCells.push(r*15+c);
      count++;
    }

    // Check backward in the opposite direction
    for (let step = 1; step < 5; step++) {
      const r = row - dr * step;
      const c = col - dc * step;
      if (r < 0 || r >= size || c < 0 || c >= size || board[r * size + c] !== symbol)
        break;
      winningCells.push(r*15+c);
      count++;
    }

    // If we have a winning line, return the cells
    if (count >= 5) {
      return winningCells;
    }
  }

  return; // No winning line found
}
