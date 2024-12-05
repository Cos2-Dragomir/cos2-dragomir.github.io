let isTracking = false;
let net;
let goodPostureShoulderY = 0;
let notificationPermission = false;
let video;
let canvas;
let ctx;
let startButton;
let calibrateButton;
let statusDiv;
let audioContext;
let mediaStream;

const POINT_COLOR = '#4CAF50';
const LINE_COLOR = '#2196F3';
const POINT_RADIUS = 8;
const LINE_WIDTH = 3;

let pointScale = 1;
let increasing = true;

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    
    const themeIcon = document.getElementById('themeIcon');
    themeIcon.textContent = newTheme === 'dark' ? '🌙' : '☀️';
    
    localStorage.setItem('theme', newTheme);
}

function loadSavedTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    const themeIcon = document.getElementById('themeIcon');
    themeIcon.textContent = savedTheme === 'dark' ? '🌙' : '☀️';
}

document.addEventListener('DOMContentLoaded', async () => {
    video = document.getElementById('webcam');
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    startButton = document.getElementById('startButton');
    calibrateButton = document.getElementById('calibrateButton');
    statusDiv = document.getElementById('status');
    
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    startButton.onclick = handleStartButton;
    calibrateButton.onclick = handleCalibration;
    document.addEventListener('visibilitychange', handleVisibilityChange);
    addButtonHoverEffects();

    try {
        await init();
        showSuccessMessage('Система готова к работе!');
    } catch (error) {
        console.error('Initialization error:', error);
        showErrorMessage('Ошибка инициализации: ' + error.message);
    }

    const instructionsToggle = document.getElementById('instructionsToggle');
    const instructions = document.getElementById('instructionsContent');
    
    instructionsToggle.addEventListener('click', () => {
        instructions.classList.toggle('collapsed');
        instructionsToggle.classList.toggle('rotated');
    });

    try {
        await init();
        showSuccessMessage('Система готова к работе!');
    } catch (error) {
        console.error('Initialization error:', error);
        showErrorMessage('Ошибка инициализации: ' + error.message);
    }
});

function addButtonHoverEffects() {
    [startButton, calibrateButton].forEach(button => {
        button.addEventListener('mouseover', () => {
            button.style.transform = 'translateY(-2px)';
        });
        button.addEventListener('mouseout', () => {
            button.style.transform = 'translateY(0)';
        });
    });
}

function showSuccessMessage(message) {
    statusDiv.textContent = message;
    statusDiv.className = 'status good';
    statusDiv.style.animation = 'fadeIn 0.5s ease-in-out';
}

function showErrorMessage(message) {
    statusDiv.textContent = message;
    statusDiv.className = 'status bad';
    statusDiv.style.animation = 'shake 0.5s ease-in-out';
}

async function requestNotificationPermission() {
    if ('Notification' in window) {
        const permission = await Notification.requestPermission();
        notificationPermission = permission === 'granted';
        if (notificationPermission) {
            showSuccessMessage('Уведомления включены');
        } else {
            showErrorMessage('Для лучшей работы включите уведомления');
        }
    }
}

async function setupCamera() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: 640,
                height: 480,
                frameRate: { ideal: 30 }
            },
            audio: false
        });
        
        video.srcObject = mediaStream;
        video.setAttribute('autoplay', '');
        video.setAttribute('muted', '');
        video.setAttribute('playsinline', '');
        
        canvas.width = video.width;
        canvas.height = video.height;
        
        return new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                resolve(video);
            };
        });
    } catch (error) {
        showErrorMessage('Ошибка доступа к камере: ' + error.message);
        throw error;
    }
}

function playWarningSound() {
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.type = 'sine';
    
    oscillator.frequency.setValueAtTime(440, audioContext.currentTime); 
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.2, audioContext.currentTime + 0.1);
    gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.3);
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.3);
}

function showNotification() {
    if (notificationPermission) {
        new Notification('Поправьте осанку!', {
            body: 'Выпрямите спину для правильной осанки',
            icon: '/path/to/your/icon.png', // Добавьте путь к вашей иконке
            silent: true
        });
    }
}

async function loadPoseNet() {
    try {
        showSuccessMessage('Загрузка системы отслеживания...');
        net = await posenet.load({
            architecture: 'MobileNetV1',
            outputStride: 16,
            multiplier: 0.75,
            inputResolution: { width: 640, height: 480 },
            quantBytes: 2
        });
        showSuccessMessage('Система отслеживания загружена!');
    } catch (error) {
        showErrorMessage('Ошибка загрузки PoseNet: ' + error.message);
        throw error;
    }
}

function drawPoint(x, y, radius) {
    ctx.beginPath();
    ctx.arc(x, y, radius * pointScale, 0, 2 * Math.PI);
    ctx.fillStyle = POINT_COLOR;
    ctx.fill();
}

function drawLine(startX, startY, endX, endY) {
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = LINE_WIDTH;
    ctx.stroke();
}

function updatePointAnimation() {
    if (increasing) {
        pointScale += 0.03;
        if (pointScale >= 1.2) increasing = false;
    } else {
        pointScale -= 0.03;
        if (pointScale <= 0.8) increasing = true;
    }
}

let lastNotificationTime = 0;
const NOTIFICATION_COOLDOWN = 3000;

async function detectPose() {
    if (!isTracking) return;
    
    try {
        const pose = await net.estimateSinglePose(video, {
            flipHorizontal: false
        });
        
        const leftShoulder = pose.keypoints.find(k => k.part === 'leftShoulder');
        const rightShoulder = pose.keypoints.find(k => k.part === 'rightShoulder');
        
        if (leftShoulder && rightShoulder) {
            const currentShoulderY = (leftShoulder.position.y + rightShoulder.position.y) / 2;
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            drawLine(
                leftShoulder.position.x, 
                leftShoulder.position.y, 
                rightShoulder.position.x, 
                rightShoulder.position.y
            );
            
            updatePointAnimation();
            drawPoint(leftShoulder.position.x, leftShoulder.position.y, POINT_RADIUS);
            drawPoint(rightShoulder.position.x, rightShoulder.position.y, POINT_RADIUS);
            
            if (currentShoulderY > goodPostureShoulderY + 10) {
                showErrorMessage('Выпрямите спину!');
                playWarningSound();
                
                const currentTime = Date.now();
                if (currentTime - lastNotificationTime > NOTIFICATION_COOLDOWN) {
                    showNotification();
                    lastNotificationTime = currentTime;
                }
            } else {
                showSuccessMessage('Отличная осанка!');
            }
        }
    } catch (error) {
        console.error('Pose detection error:', error);
    }
    
    requestAnimationFrame(detectPose);
}

async function handleStartButton() {
    if (!isTracking) {
        isTracking = true;
        startButton.innerHTML = '<span class="button-icon">⏹️</span>Остановить';
        startButton.classList.add('active');
        //await requestNotificationPermission();
        detectPose();
    } else {
        isTracking = false;
        startButton.innerHTML = '<span class="button-icon">▶️</span>Начать отслеживание';
        startButton.classList.remove('active');
        showSuccessMessage('Отслеживание остановлено');
    }
}

async function handleCalibration() {
    try {
        calibrateButton.disabled = true;
        calibrateButton.textContent = 'Калибровка...';
        
        const pose = await net.estimateSinglePose(video, {
            flipHorizontal: false
        });
        
        const leftShoulder = pose.keypoints.find(k => k.part === 'leftShoulder');
        const rightShoulder = pose.keypoints.find(k => k.part === 'rightShoulder');
        
        if (leftShoulder && rightShoulder) {
            goodPostureShoulderY = (leftShoulder.position.y + rightShoulder.position.y) / 2;
            //goodPostureShoulderX = (leftShoulder.position.x + rightShoulder.position.x) / 2;
            showSuccessMessage('Калибровка завершена успешно!');
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            drawPoint(leftShoulder.position.x, leftShoulder.position.y, POINT_RADIUS * 1.5);
            drawPoint(rightShoulder.position.x, rightShoulder.position.y, POINT_RADIUS * 1.5);
            drawLine(leftShoulder.position.x, leftShoulder.position.y, 
                    rightShoulder.position.x, rightShoulder.position.y);
        }
    } catch (error) {
        showErrorMessage('Ошибка калибровки: ' + error.message);
    } finally {
        calibrateButton.disabled = false;
        calibrateButton.innerHTML = '<span class="button-icon">📏</span>Калибровка';
    }
}

function handleVisibilityChange() {
    video.play();
    audioContext.resume();
}

async function init() {
    await setupCamera();
    await loadPoseNet();
    showSuccessMessage('Всё готово! Начните с калибровки.');
}