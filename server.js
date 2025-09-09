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

// Секретные ключи
const JWT_SECRET = process.env.JWT_SECRET || 'sova-trade-secret-key-2024';
const AUTO_ACTIVATE_SECRET = process.env.AUTO_ACTIVATE_SECRET || 'auto-activate-secret-key-2024';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin-secret-key-2024';

// Хранилище данных
let signals = [];
let signalCount = 0;
let users = [];
let subscriptions = [];
let activeSessions = new Map();

// Middleware для проверки аутентификации
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Требуется аутентификация' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Недействительный токен' });
    }
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

// Middleware для проверки админских прав
const requireAdmin = (req, res, next) => {
  const adminToken = req.headers['admin-token'];
  if (adminToken !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Admin access required' });
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
    
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });
    
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

// Автоматическая активация подписки (вызывается с yes-pay.html)
app.post('/api/auto-activate', async (req, res) => {
  try {
    // Проверяем секретный ключ
    const authHeader = req.headers['authorization'];
    if (authHeader !== AUTO_ACTIVATE_SECRET) {
      console.log('❌ Invalid activation key:', authHeader);
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid activation key' 
      });
    }
    
    const { email, orderId, amount, currency, paymentSystem } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email is required' 
      });
    }
    
    console.log('🔄 Auto-activating subscription for:', email, 'Order:', orderId);
    
    // Ищем или создаем пользователя
    let user = users.find(u => u.email === email);
    let isNewUser = false;
    
    if (!user) {
      const tempPassword = Math.random().toString(36).slice(-8);
      const hashedPassword = await bcrypt.hash(tempPassword, 10);
      
      user = {
        id: Date.now(),
        email: email,
        password: hashedPassword,
        createdAt: new Date(),
        tempPassword: tempPassword
      };
      
      users.push(user);
      isNewUser = true;
      console.log('👤 New user created:', email);
    }
    
    // Активируем подписку
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 1); // 1 месяц подписки

    // Удаляем старые подписки пользователя
    subscriptions = subscriptions.filter(sub => sub.userId !== user.id);
    
    const newSubscription = {
      userId: user.id,
      status: 'active',
      activatedAt: new Date(),
      expiresAt,
      months: 1,
      transactionId: orderId || `auto_${Date.now()}`,
      amount: amount || 45,
      currency: currency || 'USD',
      paymentSystem: paymentSystem || 'auto'
    };
    
    subscriptions.push(newSubscription);

    console.log('✅ Subscription activated for:', email);
    console.log('📊 Subscription details:', newSubscription);
    
    res.json({
      success: true,
      message: 'Subscription activated successfully',
      user: {
        email: user.email,
        userId: user.id,
        isNewUser: isNewUser
      },
      subscription: newSubscription
    });
    
  } catch (error) {
    console.error('Auto-activation error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// Маршрут для приёма сигналов от советника
app.post('/api/receive_signal', (req, res) => {
  try {
    const { asset, signal } = req.body;
    
    if (!asset || !signal) {
      return res.status(400).json({ error: 'Missing asset or signal' });
    }

    const newSignal = {
      id: ++signalCount,
      asset,
      signal,
      timestamp: new Date(),
      source: 'MT4 Advisor'
    };

    signals.push(newSignal);
    
    if (signals.length > 1000) {
      signals = signals.slice(-1000);
    }

    console.log('📨 Received signal:', newSignal);
    res.status(200).json({ 
      message: 'Signal received successfully',
      signal: newSignal
    });

  } catch (error) {
    console.error('Error processing signal:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Маршрут для получения всех сигналов
app.get('/api/get_signals', authenticateToken, checkSubscription, (req, res) => {
  res.json({
    total: signals.length,
    signals: signals.reverse()
  });
});

// Маршрут для проверки статуса подписки
app.get('/api/subscription_status', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const userSubscription = subscriptions.find(sub => sub.userId === userId);
  
  if (!userSubscription) {
    return res.json({ hasSubscription: false });
  }
  
  if (new Date() > new Date(userSubscription.expiresAt)) {
    userSubscription.status = 'expired';
    return res.json({ 
      hasSubscription: false,
      status: 'expired'
    });
  }
  
  res.json({
    hasSubscription: userSubscription.status === 'active',
    status: userSubscription.status,
    expiresAt: userSubscription.expiresAt
  });
});

// Проверка подписки по email
app.get('/api/check-subscription-by-email', (req, res) => {
  const { email } = req.query;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  
  const user = users.find(u => u.email === email);
  if (!user) {
    return res.json({ 
      hasSubscription: false,
      message: 'User not found' 
    });
  }
  
  const subscription = subscriptions.find(sub => 
    sub.userId === user.id && sub.status === 'active'
  );
  
  if (!subscription) {
    return res.json({ 
      hasSubscription: false,
      message: 'No active subscription' 
    });
  }
  
  if (new Date() > new Date(subscription.expiresAt)) {
    subscription.status = 'expired';
    return res.json({ 
      hasSubscription: false,
      message: 'Subscription expired' 
    });
  }
  
  res.json({ 
    hasSubscription: true,
    expiresAt: subscription.expiresAt,
    activatedAt: subscription.activatedAt
  });
});

// ==================== АДМИН-ЭНДПОИНТЫ ====================

// Получение всех пользователей с подписками
app.get('/admin/users', requireAdmin, (req, res) => {
  try {
    const usersWithSubscriptions = users.map(user => {
      const subscription = subscriptions.find(sub => sub.userId === user.id);
      
      return {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
        hasSubscription: !!subscription,
        subscriptionStatus: subscription ? subscription.status : 'none',
        subscriptionExpires: subscription ? subscription.expiresAt : null,
        subscriptionCreated: subscription ? subscription.activatedAt : null,
        daysRemaining: subscription ? Math.ceil((new Date(subscription.expiresAt) - new Date()) / (1000 * 60 * 60 * 24)) : 0,
        paymentSystem: subscription ? subscription.paymentSystem : 'none',
        transactionId: subscription ? subscription.transactionId : null
      };
    });

    usersWithSubscriptions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      totalUsers: users.length,
      activeSubscriptions: subscriptions.filter(sub => sub.status === 'active').length,
      expiredSubscriptions: subscriptions.filter(sub => sub.status === 'expired').length,
      users: usersWithSubscriptions
    });

  } catch (error) {
    console.error('Admin users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Получение статистики
app.get('/admin/stats', requireAdmin, (req, res) => {
  const now = new Date();
  const activeSubs = subscriptions.filter(sub => sub.status === 'active');
  
  const stats = {
    totalUsers: users.length,
    totalSubscriptions: subscriptions.length,
    activeSubscriptions: activeSubs.length,
    expiredSubscriptions: subscriptions.filter(sub => sub.status === 'expired').length,
    expiringThisWeek: activeSubs.filter(sub => {
      const daysLeft = Math.ceil((new Date(sub.expiresAt) - now) / (1000 * 60 * 60 * 24));
      return daysLeft <= 7 && daysLeft > 0;
    }).length,
    expiredRecently: subscriptions.filter(sub => {
      const daysAgo = Math.ceil((now - new Date(sub.expiresAt)) / (1000 * 60 * 60 * 24));
      return sub.status === 'expired' && daysAgo <= 7;
    }).length,
    totalRevenue: subscriptions.reduce((sum, sub) => sum + (sub.amount || 0), 0),
    monthlyRevenue: subscriptions
      .filter(sub => new Date(sub.activatedAt) > new Date(now.getFullYear(), now.getMonth(), 1))
      .reduce((sum, sub) => sum + (sub.amount || 0), 0),
    byPaymentSystem: subscriptions.reduce((acc, sub) => {
      acc[sub.paymentSystem] = (acc[sub.paymentSystem] || 0) + 1;
      return acc;
    }, {})
  };

  res.json(stats);
});

// Ручное управление подписками
app.post('/admin/subscription', requireAdmin, (req, res) => {
  try {
    const { userId, action, months } = req.body;
    
    const user = users.find(u => u.id === userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    let subscription = subscriptions.find(sub => sub.userId === userId);
    
    switch (action) {
      case 'activate':
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + (months || 1));
        
        if (subscription) {
          subscription.status = 'active';
          subscription.expiresAt = expiresAt;
          subscription.activatedAt = new Date();
        } else {
          subscription = {
            userId: user.id,
            status: 'active',
            activatedAt: new Date(),
            expiresAt: expiresAt,
            months: months || 1,
            transactionId: `manual_${Date.now()}`,
            amount: 45 * (months || 1),
            currency: 'USD',
            paymentSystem: 'manual'
          };
          subscriptions.push(subscription);
        }
        break;
        
      case 'deactivate':
        if (subscription) {
          subscription.status = 'expired';
        }
        break;
        
      case 'delete':
        subscriptions = subscriptions.filter(sub => sub.userId !== userId);
        break;
        
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
    
    res.json({ 
      success: true, 
      message: `Subscription ${action}d successfully`,
      subscription: subscription 
    });
    
  } catch (error) {
    console.error('Admin subscription error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Поиск пользователя по email
app.get('/admin/search', requireAdmin, (req, res) => {
  const { email } = req.query;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  
  const user = users.find(u => u.email.includes(email));
  if (!user) {
    return res.json({ found: false });
  }
  
  const subscription = subscriptions.find(sub => sub.userId === user.id);
  
  res.json({
    found: true,
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt
    },
    subscription: subscription ? {
      status: subscription.status,
      expiresAt: subscription.expiresAt,
      activatedAt: subscription.activatedAt,
      daysRemaining: Math.ceil((new Date(subscription.expiresAt) - new Date()) / (1000 * 60 * 60 * 24))
    } : null
  });
});

// Маршрут для проверки работы сервера
app.get('/', (req, res) => {
  res.json({ 
    message: 'SOVA Signal Server is running! 🚀',
    endpoints: {
      register: 'POST /api/register',
      login: 'POST /api/login',
      auto_activate: 'POST /api/auto-activate',
      receive_signal: 'POST /api/receive_signal',
      get_signals: 'GET /api/get_signals',
      subscription_status: 'GET /api/subscription_status',
      check_subscription: 'GET /api/check-subscription-by-email',
      admin_users: 'GET /admin/users',
      admin_stats: 'GET /admin/stats'
    },
    stats: {
      total_signals: signals.length,
      total_users: users.length,
      active_subscriptions: subscriptions.filter(sub => sub.status === 'active').length,
      last_signal: signals.length > 0 ? signals[signals.length-1] : null
    }
  });
});

// Статистика
app.get('/api/stats', (req, res) => {
  const buySignals = signals.filter(s => s.signal === 'buy').length;
  const sellSignals = signals.filter(s => s.signal === 'sell').length;
  
  res.json({
    total_signals: signals.length,
    buy_signals: buySignals,
    sell_signals: sellSignals,
    last_signals: signals.slice(-10).reverse()
  });
});

// GET endpoint для сигналов
app.get('/api/receive_signal', (req, res) => {
  try {
    const { asset, signal } = req.query;
    
    if (!asset || !signal) {
      return res.status(400).json({ error: 'Missing asset or signal parameters' });
    }

    const newSignal = {
      id: ++signalCount,
      asset,
      signal,
      timestamp: new Date(),
      source: 'GET Request'
    };

    signals.push(newSignal);
    
    console.log('📨 GET Signal received:', newSignal);
    res.status(200).json({ 
      message: 'GET Signal received successfully',
      signal: newSignal
    });

  } catch (error) {
    console.error('Error processing GET signal:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Запуск сервера
app.listen(port, () => {
  console.log(`🚀 SOVA Signal Server running on port ${port}`);
  console.log(`📍 Auto-activation secret: ${AUTO_ACTIVATE_SECRET}`);
  console.log(`📍 Admin secret: ${ADMIN_SECRET}`);
  console.log(`📍 Endpoint for MT4: http://localhost:${port}/api/receive_signal`);
  console.log(`📍 Auto-activate endpoint: http://localhost:${port}/api/auto-activate`);
  console.log(`📊 Dashboard: http://localhost:${port}/`);
});