const WebSocket = require('ws');
const port = 8080;

const wss = new WebSocket.Server({ port });
console.log(`WebSocket server is running on ws://localhost:${port}`);

// Manage rooms
const rooms = new Map();

wss.on('connection', (ws) => {
  console.log('A player connected.');

  ws.on('message', (message) => {
    const { type, payload } = JSON.parse(message);

    if (type === 'join-room') {
      handleJoinRoom(ws, payload.roomId);
    } else if (type === 'move') {
      handleMove(ws, payload);
    }
  });

  ws.on('close', () => {
    console.log('A player disconnected.');
    handleDisconnect(ws);
  });
});

// Handle joining a room
function handleJoinRoom(ws, roomId) {
  if (!rooms.has(roomId)) {
    // Create a new room if it doesn't exist
    rooms.set(roomId, { players: [], board: Array(225).fill(null), currentTurn: null }); // 15x15 = 225
  }

  const room = rooms.get(roomId);

  if (room.players.length >= 2) {
    ws.send(JSON.stringify({ type: 'error', message: 'Room is full!' }));
    return;
  }

  room.players.push(ws);

  // Assign X or O to the player
  const symbol = room.players.length === 1 ? 'X' : 'O';
  ws.symbol = symbol;
  ws.roomId = roomId;

  ws.send(JSON.stringify({ type: 'game-start', message: 'Game started!', roomId, symbol }));

  if (room.players.length === 2) {
    room.currentTurn = room.players[0];
    room.players.forEach((player) =>
      player.send(JSON.stringify({ type: 'game-ready', size: 15, message: 'Both players connected!' }))
    );
  } else {
    ws.send(JSON.stringify({ type: 'waiting', message: 'Waiting for another player...' }));
  }
}

// Handle a player's move
function handleMove(ws, { index }) {
  const room = rooms.get(ws.roomId);
  if (!room) return;

  if (room.currentTurn !== ws) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not your turn!' }));
    return;
  }

  if (room.board[index] || index < 0 || index >= room.board.length) {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid move!' }));
    return;
  }

  // Update the board and switch turns
  room.board[index] = ws.symbol;
  room.currentTurn = room.players.find((player) => player !== ws);

  // Broadcast the move to both players
  room.players.forEach((player) =>
    player.send(JSON.stringify({ type: 'move', payload: { index, symbol: ws.symbol } }))
  );

  // Check for a win or draw
  const winner = checkWin(room.board, ws.symbol, index);
  if (winner) {
    room.players.forEach((player) =>
      player.send(JSON.stringify({ type: 'game-over', message: `${ws.symbol} wins!` }))
    );
    rooms.delete(ws.roomId);
  } else if (room.board.every((cell) => cell)) {
    room.players.forEach((player) =>
      player.send(JSON.stringify({ type: 'game-over', message: 'It\'s a draw!' }))
    );
    rooms.delete(ws.roomId);
  }
}

// Handle player disconnection
function handleDisconnect(ws) {
  const roomId = ws.roomId;
  if (!roomId || !rooms.has(roomId)) return;

  const room = rooms.get(roomId);

  // Notify the other player and delete the room
  room.players.forEach((player) => {
    if (player !== ws) {
      player.send(JSON.stringify({ type: 'game-over', message: 'Opponent disconnected!' }));
    }
  });

  rooms.delete(roomId);
}

// Check win condition
function checkWin(board, symbol, index) {
  const size = 15; // 15x15 board
  const row = Math.floor(index / size);
  const col = index % size;

  const directions = [
    { dr: 0, dc: 1 }, // Horizontal
    { dr: 1, dc: 0 }, // Vertical
    { dr: 1, dc: 1 }, // Diagonal (top-left to bottom-right)
    { dr: 1, dc: -1 }, // Diagonal (top-right to bottom-left)
  ];

  for (const { dr, dc } of directions) {
    let count = 1;

    for (let step = 1; step < 5; step++) {
      const r = row + dr * step;
      const c = col + dc * step;
      if (r < 0 || r >= size || c < 0 || c >= size || board[r * size + c] !== symbol) break;
      count++;
    }

    for (let step = 1; step < 5; step++) {
      const r = row - dr * step;
      const c = col - dc * step;
      if (r < 0 || r >= size || c < 0 || c >= size || board[r * size + c] !== symbol) break;
      count++;
    }

    if (count >= 5) return true;
  }

  return false;
}
