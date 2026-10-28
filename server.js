const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
const questions = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'questions_enade.json'), 'utf8').replace(/^\uFEFF/, ''));
const rooms = {};

io.on('connection', (socket) => {
  socket.on('createRoom', () => {
    const roomId = Math.floor(100000 + Math.random() * 900000).toString();
    rooms[roomId] = { hostId: socket.id, players: {}, currentQuestionIndex: 0, state: 'LOBBY', questions: [...questions] };
    socket.join(roomId);
    socket.emit('roomCreated', { roomId });
  });

  socket.on('joinRoom', ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('errorMsg', 'Sala não encontrada!');
    if (room.state !== 'LOBBY') return socket.emit('errorMsg', 'O jogo já começou!');
    room.players[socket.id] = { name, score: 0, currentAnswer: null };
    socket.join(roomId);
    socket.emit('joinedSuccess', { roomId, name });
    io.to(room.hostId).emit('updatePlayers', Object.values(room.players).map(p => p.name));
  });

  socket.on('startGame', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;
    room.state = 'QUESTION';
    room.currentQuestionIndex = 0;
    sendQuestion(roomId);
  });

  socket.on('submitAnswer', ({ roomId, answerIndex }) => {
    const room = rooms[roomId];
    if (!room || room.state !== 'QUESTION') return;
    const player = room.players[socket.id];
    if (player && player.currentAnswer === null) {
      player.currentAnswer = answerIndex;
      socket.emit('answerSubmitted');
    }
  });

  socket.on('revealAnswer', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;
    const q = room.questions[room.currentQuestionIndex];
    
    // Destaca a resposta na tela do Host
    socket.emit('answerRevealed', { correctIndex: q.resposta_correta });

    // Mostra se o aluno acertou ou errou
    Object.keys(room.players).forEach(playerId => {
      const p = room.players[playerId];
      const isCorrect = (p.currentAnswer === q.resposta_correta);
      if (isCorrect) p.score += 100;
      io.to(playerId).emit('playerResult', { 
        isCorrect: isCorrect, 
        correctText: q.alternativas[q.resposta_correta] 
      });
    });
  });

  socket.on('nextQuestion', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;
    room.currentQuestionIndex++;
    if (room.currentQuestionIndex < room.questions.length) {
      Object.values(room.players).forEach(p => p.currentAnswer = null);
      sendQuestion(roomId);
    } else {
      room.state = 'ENDED';
      const leaderboard = Object.values(room.players).sort((a, b) => b.score - a.score);
      io.to(roomId).emit('gameOver', { leaderboard });
    }
  });

  function sendQuestion(roomId) {
    const room = rooms[roomId];
    const q = room.questions[room.currentQuestionIndex];
    io.to(roomId).emit('newQuestion', {
      number: room.currentQuestionIndex + 1, total: room.questions.length,
      enunciado: q.enunciado, alternativas: q.alternativas
    });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Servidor rodando na porta ${PORT}`); });