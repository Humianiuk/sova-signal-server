const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Секретный ключ для JWT
const JWT_SECRET = process.env.JWT_SECRET || 'sova-trade-secret-key-2024';
const MAX_DEVICES = 2; // Максимальное количество устройств

// Хранилище данных
let signals = [];
let signalCount = 0;
let users = [];
let subscriptions = [];
let activeSessions = new Map(); // Активные сессии: userId -> {token, ip, userAgent, lastActivity}

// Middleware для получения IP клиента
const getClientIP = (req) => {
  return req.ip || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress ||
         (req.connection.socket ? req.connection.socket.remoteAddress : null);
};

// Middleware для проверки аутентификации
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  const clientIP = getClientIP(req);
  const userAgent = req.get('User-Agent');

  if (!token) {
    return res.status(401).json({ error: 'Требуется аутентификация' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Недействительный токен' });
    }

    // Проверяем активную сессию
    const sessionData = activeSessions.get(user.userId);
    if (!sessionData || sessionData.token !== token) {
      return res.status(403).json({ error: 'Сессия истекла или недействительна' });
    }

    // Обновляем время последней активности
    sessionData.lastActivity = new Date();
    activeSessions.set(user.userId, sessionData);

    req.user = user;
    next();
  });
};

// Middleware для проверки активной подписки
const checkSubscription = (req, res, next) => {
  const userId = req.user.userId;
  const userSubscription = subscriptions.find(sub => sub.userId === userId && sub.status === 'active');
  
  if (!userSubscription) {
    return res.status(403).json({ error: 'Требуется активная подписка' });
  }
  
  if (new Date() > new Date(userSubscription.expiresAt)) {
    userSubscription.status = 'expired';
    return res.status(403).json({ error: 'Подписка истекла' });
  }
  
  next();
};

// Регистрация пользователя
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email и пароль обязательны' });
    }
    
    if (users.find(user => user.email === email)) {
      return res.status(400).json({ error: 'Пользователь уже существует' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const newUser = {
      id: Date.now(),
      email,
      password: hashedPassword,
      createdAt: new Date()
    };
    
    users.push(newUser);
    
    const token = jwt.sign({ userId: newUser.id }, JWT_SECRET, { expiresIn: '24h' });
    
    res.status(201).json({
      message: 'Пользователь успешно зарегистрирован',
      token,
      userId: newUser.id
    });
    
  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// Аутентификация пользователя
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const clientIP = getClientIP(req);
    const userAgent = req.get('User-Agent');
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email и пароль обязательны' });
    }
    
    const user = users.find(user => user.email === email);
    if (!user) {
      return res.status(400).json({ error: 'Неверные учетные данные' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Неверные учетные данные' });
    }
    
    // Проверяем количество активных сессий
    const userSessions = Array.from(activeSessions.entries())
      .filter(([userId, session]) => userId === user.id);
    
    if (userSessions.length >= MAX_DEVICES) {
      return res.status(403).json({ 
        error: `Превышено максимальное количество устройств (${MAX_DEVICES}). Выйдите из системы на других устройствах.` 
      });
    }
    
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });
    
    // Сохраняем активную сессию
    activeSessions.set(user.id, {
      token,
      ip: clientIP,
      userAgent,
      lastActivity: new Date()
    });
    
    res.json({
      message: 'Успешный вход',
      token,
      userId: user.id
    });
    
  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// Выход из системы
app.post('/api/logout', authenticateToken, (req, res) => {
  activeSessions.delete(req.user.userId);
  res.json({ message: 'Успешный выход' });
});

// Получение информации о сессиях пользователя
app.get('/api/sessions', authenticateToken, (req, res) => {
  const userSessions = Array.from(activeSessions.entries())
    .filter(([userId, session]) => userId === req.user.userId)
    .map(([userId, session]) => ({
      ip: session.ip,
      userAgent: session.userAgent,
      lastActivity: session.lastActivity
    }));
  
  res.json({ sessions: userSessions });
});

// Завершение всех сессий кроме текущей
app.post('/api/logout-other-sessions', authenticateToken, (req, res) => {
  const currentToken = req.headers['authorization'].split(' ')[1];
  
  Array.from(activeSessions.entries())
    .filter(([userId, session]) => userId === req.user.userId && session.token !== currentToken)
    .forEach(([userId, session]) => {
      activeSessions.delete(userId);
    });
  
  res.json({ message: 'Остальные сессии завершены' });
});

// Остальные endpoints остаются без изменений...
// [Здесь должен быть остальной код из предыдущей версии server.js]

// Очистка неактивных сессий каждые 5 минут
setInterval(() => {
  const now = new Date();
  for (const [userId, session] of activeSessions.entries()) {
    if (now - session.lastActivity > 30 * 60 * 1000) { // 30 минут неактивности
      activeSessions.delete(userId);
      console.log(`Сессия пользователя ${userId} очищена due to inactivity`);
    }
  }
}, 5 * 60 * 1000);

// Запуск сервера
app.listen(port, () => {
  console.log(`🚀 SOVA Signal Server running on port ${port}`);
  console.log(`📍 Максимальное количество устройств: ${MAX_DEVICES}`);
});
