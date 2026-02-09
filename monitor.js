import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// 配置管理
// ============================================================

// 环境变量优先，没有则使用代码里填写的默认值
const DEFAULT_CONFIG = {
  ARGO_DOMAIN: 'databricks.argo.dmain.com',                        // (必填)填写自己的隧道域名
  DATABRICKS_HOST: 'https://abc-1223456789.cloud.databricks.com',   // (必填)直接填写工作区host或添加 GitHub Secrets: DATABRICKS_HOST
  DATABRICKS_TOKEN: 'dapi6dae4632d66931ecdeefe8808f12678dse',       // (必填)直接填写token或添加 GitHub Secrets: DATABRICKS_TOKEN
  CHAT_ID: '',                                                      // 填写 Telegram 聊天 ID 或添加 GitHub Secrets: CHAT_ID（可选）
  BOT_TOKEN: ''                                                     // 填写 Telegram 机器人 Token 或添加 GitHub Secrets: BOT_TOKEN（可选）
};

// ARGO 状态缓存文件路径
const ARGO_STATUS_FILE = path.join(__dirname, '.argo-status.json');

// 获取配置
function getConfig() {
  const env = process.env;
  const host = env.DATABRICKS_HOST || DEFAULT_CONFIG.DATABRICKS_HOST;
  const token = env.DATABRICKS_TOKEN || DEFAULT_CONFIG.DATABRICKS_TOKEN;
  const chatId = env.CHAT_ID || DEFAULT_CONFIG.CHAT_ID;
  const botToken = env.BOT_TOKEN || DEFAULT_CONFIG.BOT_TOKEN;
  const argoDomain = env.ARGO_DOMAIN || DEFAULT_CONFIG.ARGO_DOMAIN;

  return {
    DATABRICKS_HOST: host,
    DATABRICKS_TOKEN: token,
    CHAT_ID: chatId,
    BOT_TOKEN: botToken,
    ARGO_DOMAIN: argoDomain,
    source: {
      host: env.DATABRICKS_HOST ? '环境变量' : '默认值',
      token: env.DATABRICKS_TOKEN ? '环境变量' : '默认值',
      chatId: env.CHAT_ID ? '环境变量' : '默认值',
      botToken: env.BOT_TOKEN ? '环境变量' : '默认值',
      argoDomain: env.ARGO_DOMAIN ? '环境变量' : '默认值'
    }
  };
}

// ============================================================
// ARGO 状态持久化（使用文件代替内存变量，适配 GitHub Actions 无状态环境）
// ============================================================

function loadLastArgoStatus() {
  try {
    if (fs.existsSync(ARGO_STATUS_FILE)) {
      const data = fs.readFileSync(ARGO_STATUS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('读取 ARGO 状态缓存失败:', error.message);
  }
  return null;
}

function saveArgoStatus(status) {
  try {
    fs.writeFileSync(ARGO_STATUS_FILE, JSON.stringify(status, null, 2), 'utf-8');
    console.log('ARGO 状态已保存到缓存文件');
  } catch (error) {
    console.error('保存 ARGO 状态缓存失败:', error.message);
  }
}

// ============================================================
// ARGO 域名检查
// ============================================================

async function checkArgoDomain(argoDomain) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(`https://${argoDomain}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Databricks-Monitor/1.0'
      },
      signal: controller.signal
    });

    clearTimeout(timeout);

    const statusCode = response.status;
    console.log(`ARGO 域名 ${argoDomain} 状态码: ${statusCode}`);

    return {
      online: statusCode === 404 || statusCode === 502,
      statusCode,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error(`检查 ARGO 域名 ${argoDomain} 时出错:`, error.message);
    return {
      online: false,
      statusCode: null,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

function hasArgoStatusChanged(lastStatus, newStatus) {
  if (!lastStatus) return true;
  return lastStatus.online !== newStatus.online ||
         lastStatus.statusCode !== newStatus.statusCode;
}

// ============================================================
// Telegram 通知
// ============================================================

async function sendTelegramNotification(config, message) {
  const { CHAT_ID, BOT_TOKEN } = config;

  if (!CHAT_ID || !BOT_TOKEN) {
    console.log('Telegram 通知未配置，跳过发送');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'HTML'
      }),
    });

    const result = await response.json();

    if (result.ok) {
      console.log('Telegram 通知发送成功');
      return true;
    } else {
      console.error('Telegram 通知发送失败:', result);
      return false;
    }
  } catch (error) {
    console.error('发送 Telegram 通知时出错:', error.message);
    return false;
  }
}

async function sendArgoOfflineNotification(config, argoStatus) {
  const message = `🔴 <b>ARGO 隧道离线</b>\n\n` +
    `🌐 域名: <code>${config.ARGO_DOMAIN}</code>\n` +
    `📊 状态码: <code>${argoStatus.statusCode || '连接失败'}</code>\n` +
    `⏰ 时间: ${new Date().toLocaleString('zh-CN')}\n` +
    `🏷️ 触发: GitHub Actions\n\n` +
    `🔍 正在检查 Databricks App 状态...`;

  return await sendTelegramNotification(config, message);
}

async function sendArgoRecoveryNotification(config) {
  const message = `✅ <b>ARGO 隧道恢复</b>\n\n` +
    `🌐 域名: <code>${config.ARGO_DOMAIN}</code>\n` +
    `📊 状态: <code>404|502 (正常)</code>\n` +
    `⏰ 时间: ${new Date().toLocaleString('zh-CN')}\n` +
    `🏷️ 触发: GitHub Actions\n\n` +
    `🎉 节点已恢复正常`;

  return await sendTelegramNotification(config, message);
}

async function sendOfflineNotification(config, appName, appId) {
  const message = `🔴 <b>Databricks App 离线</b>\n\n` +
    `📱 App: <code>${appName}</code>\n` +
    `🆔 ID: <code>${appId}</code>\n` +
    `🌐 ARGO: <code>${config.ARGO_DOMAIN}</code>\n` +
    `⏰ 时间: ${new Date().toLocaleString('zh-CN')}\n` +
    `🏷️ 触发: GitHub Actions\n\n` +
    `⚡ 系统正在尝试自动重启...`;

  return await sendTelegramNotification(config, message);
}

async function sendStartSuccessNotification(config, appName, appId) {
  const message = `✅ <b>Databricks App 启动成功</b>\n\n` +
    `📱 App: <code>${appName}</code>\n` +
    `🆔 ID: <code>${appId}</code>\n` +
    `🌐 ARGO: <code>${config.ARGO_DOMAIN}</code>\n` +
    `⏰ 时间: ${new Date().toLocaleString('zh-CN')}\n` +
    `🏷️ 触发: GitHub Actions\n\n` +
    `🎉 App 正在启动中，请等待 ARGO 恢复后再检查节点`;

  return await sendTelegramNotification(config, message);
}

async function sendStartFailedNotification(config, appName, appId, error) {
  const message = `❌ <b>Databricks App 启动失败</b>\n\n` +
    `📱 App: <code>${appName}</code>\n` +
    `🆔 ID: <code>${appId}</code>\n` +
    `🌐 ARGO: <code>${config.ARGO_DOMAIN}</code>\n` +
    `⏰ 时间: ${new Date().toLocaleString('zh-CN')}\n` +
    `💥 错误: <code>${error}</code>\n` +
    `🏷️ 触发: GitHub Actions\n\n` +
    `🔧 请检查 App 配置或手动触发 GitHub Actions 的 start 操作`;

  return await sendTelegramNotification(config, message);
}

async function sendManualOperationNotification(config, operation, results) {
  const successCount = results.filter(r => r.status === 'started').length;
  const failedCount = results.filter(r => r.status === 'start_failed' || r.status === 'error').length;
  const stoppedCount = results.filter(r => r.computeState === 'STOPPED').length;

  const message = `📊 <b>Databricks Apps ${operation}</b>\n\n` +
    `✅ 成功启动: ${successCount} 个\n` +
    `❌ 启动失败: ${failedCount} 个\n` +
    `⏸️ 停止状态: ${stoppedCount} 个\n` +
    `🌐 ARGO域名: <code>${config.ARGO_DOMAIN}</code>\n` +
    `⏰ 时间: ${new Date().toLocaleString('zh-CN')}\n` +
    `🏷️ 触发: GitHub Actions`;

  return await sendTelegramNotification(config, message);
}

// ============================================================
// Databricks API 操作
// ============================================================

async function getAppsList(config) {
  const { DATABRICKS_HOST, DATABRICKS_TOKEN } = config;

  let allApps = [];
  let pageToken = '';

  do {
    let url = `${DATABRICKS_HOST}/api/2.0/apps?page_size=50`;
    if (pageToken) {
      url += `&page_token=${encodeURIComponent(pageToken)}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${DATABRICKS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const apps = data.apps || [];

    allApps = allApps.concat(apps);
    pageToken = data.next_page_token || '';
  } while (pageToken);

  return allApps;
}

async function getAppsStatus(config) {
  const apps = await getAppsList(config);

  const results = apps.map(app => ({
    name: app.name,
    id: app.id,
    state: app.compute_status?.state || 'UNKNOWN',
    url: app.url,
    createdAt: app.creation_timestamp,
    lastUpdated: app.last_updated_timestamp
  }));

  const summary = {
    total: results.length,
    active: results.filter(app => app.state === 'ACTIVE').length,
    stopped: results.filter(app => app.state === 'STOPPED').length,
    unknown: results.filter(app => app.state === 'UNKNOWN').length,
    other: results.filter(app => !['ACTIVE', 'STOPPED', 'UNKNOWN'].includes(app.state)).length
  };

  return { summary, apps: results };
}

async function startSingleApp(app, config) {
  const { DATABRICKS_HOST, DATABRICKS_TOKEN } = config;
  const appName = app.name;
  const appId = app.id;

  try {
    const encodedAppName = encodeURIComponent(appName);
    const startUrl = `${DATABRICKS_HOST}/api/2.0/apps/${encodedAppName}/start`;

    console.log(`启动 URL: ${startUrl}`);

    const response = await fetch(startUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DATABRICKS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const responseText = await response.text();
    console.log(`启动响应: ${responseText}`);

    if (response.ok) {
      console.log(`✅ App ${appName} 启动成功`);
      await sendStartSuccessNotification(config, appName, appId);
      return {
        app: appName,
        appId,
        status: 'started',
        success: true,
        timestamp: new Date().toISOString()
      };
    } else {
      console.error(`❌ App ${appName} 启动失败:`, responseText);

      let errorDetails;
      try {
        errorDetails = JSON.parse(responseText);
      } catch {
        errorDetails = { message: responseText };
      }

      const errorMessage = errorDetails.message || '未知错误';
      await sendStartFailedNotification(config, appName, appId, errorMessage);

      return {
        app: appName,
        appId,
        status: 'start_failed',
        error: errorDetails,
        timestamp: new Date().toISOString()
      };
    }
  } catch (error) {
    console.error(`❌ App ${appName} 启动请求错误:`, error.message);
    await sendStartFailedNotification(config, appName, appId, error.message);

    return {
      app: appName,
      appId,
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function processApp(app, config) {
  const appName = app.name;
  const appId = app.id;
  const computeState = app.compute_status?.state || 'UNKNOWN';

  console.log(`检查 App: ${appName} (ID: ${appId}) | Compute状态: ${computeState}`);

  if (computeState === 'STOPPED') {
    console.log(`⚡ 启动停止的 App: ${appName}`);
    await sendOfflineNotification(config, appName, appId);
    return await startSingleApp(app, config);
  } else {
    console.log(`✅ App ${appName} 状态正常: ${computeState}`);
    return {
      app: appName,
      appId,
      status: 'healthy',
      computeState,
      timestamp: new Date().toISOString()
    };
  }
}

// ============================================================
// 核心操作
// ============================================================

// 智能检查：只在 ARGO 状态变化时调用 Databricks API
async function smartCheckAndStartApps(config) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`检查 ARGO 域名: ${config.ARGO_DOMAIN}`);
  console.log(`${'='.repeat(60)}\n`);

  const lastArgoStatus = loadLastArgoStatus();
  const currentArgoStatus = await checkArgoDomain(config.ARGO_DOMAIN);
  const statusChanged = hasArgoStatusChanged(lastArgoStatus, currentArgoStatus);

  if (currentArgoStatus.online) {
    console.log(`✅ ARGO 域名 ${config.ARGO_DOMAIN} 状态正常`);

    // 如果状态从离线变为在线，发送恢复通知
    if (statusChanged && lastArgoStatus && !lastArgoStatus.online) {
      console.log('ARGO 状态从离线恢复为在线，发送恢复通知');
      await sendArgoRecoveryNotification(config);
    }

    // 保存状态
    saveArgoStatus(currentArgoStatus);

    return {
      argoStatus: 'online',
      statusChanged,
      message: 'ARGO 隧道运行正常',
      timestamp: new Date().toISOString()
    };
  }

  console.log(`🔴 ARGO 域名 ${config.ARGO_DOMAIN} 离线，状态码: ${currentArgoStatus.statusCode}`);

  // 如果 ARGO 状态变化为离线，发送通知
  if (statusChanged) {
    console.log('ARGO 状态变化为离线，发送通知并检查 Databricks Apps');
    await sendArgoOfflineNotification(config, currentArgoStatus);
  }

  // ARGO 离线，检查 Databricks Apps
  const apps = await getAppsList(config);
  const results = [];

  for (const app of apps) {
    const result = await processApp(app, config);
    results.push(result);
  }

  console.log(`\nARGO 离线检查完成，共处理 ${results.length} 个 Apps`);

  // 保存状态
  saveArgoStatus(currentArgoStatus);

  return {
    argoStatus: 'offline',
    statusChanged,
    argoDetails: currentArgoStatus,
    results,
    timestamp: new Date().toISOString()
  };
}

// 启动停止的 Apps
async function startStoppedApps(config) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('手动启动所有停止的 Apps');
  console.log(`${'='.repeat(60)}\n`);

  const apps = await getAppsList(config);
  const stoppedApps = apps.filter(app => (app.compute_status?.state || 'UNKNOWN') === 'STOPPED');
  const results = [];

  console.log(`找到 ${stoppedApps.length} 个停止的 Apps（共 ${apps.length} 个）`);

  for (const app of stoppedApps) {
    const result = await startSingleApp(app, config);
    results.push(result);
  }

  if (stoppedApps.length > 0) {
    await sendManualOperationNotification(config, '手动启动', results);
  } else {
    console.log('没有停止的 Apps 需要启动');
  }

  return results;
}

// 获取并打印 Apps 状态
async function printAppsStatus(config) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('获取 Databricks Apps 状态');
  console.log(`${'='.repeat(60)}\n`);

  const status = await getAppsStatus(config);

  console.log('--- 汇总 ---');
  console.log(`总数: ${status.summary.total}`);
  console.log(`运行中 (ACTIVE): ${status.summary.active}`);
  console.log(`已停止 (STOPPED): ${status.summary.stopped}`);
  console.log(`未知 (UNKNOWN): ${status.summary.unknown}`);
  console.log(`其他: ${status.summary.other}`);

  console.log('\n--- Apps 列表 ---');
  for (const app of status.apps) {
    const stateIcon = app.state === 'ACTIVE' ? '✅' :
                      app.state === 'STOPPED' ? '🔴' : '❓';
    console.log(`${stateIcon} ${app.name} | 状态: ${app.state} | ID: ${app.id}`);
  }

  return status;
}

// 测试 Telegram 通知
async function testNotify(config) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('测试 Telegram 通知');
  console.log(`${'='.repeat(60)}\n`);

  const message = `🔔 <b>Databricks Apps 监控测试通知</b>\n\n` +
    `✅ 这是一条测试消息\n` +
    `🌐 ARGO域名: <code>${config.ARGO_DOMAIN}</code>\n` +
    `⏰ 时间: ${new Date().toLocaleString('zh-CN')}\n` +
    `🏷️ 触发: GitHub Actions\n\n` +
    `🎉 如果你收到这条消息，说明 Telegram 通知配置正确`;

  const success = await sendTelegramNotification(config, message);

  if (success) {
    console.log('✅ 测试通知发送成功');
  } else {
    console.error('❌ 测试通知发送失败，请检查 CHAT_ID 和 BOT_TOKEN 配置');
  }

  return success;
}

// ============================================================
// 主入口
// ============================================================

async function main() {
  const action = process.env.ACTION || 'check';
  const config = getConfig();

  console.log(`\n🚀 Databricks Apps 监控`);
  console.log(`📋 操作类型: ${action}`);
  console.log(`🌐 ARGO 域名: ${config.ARGO_DOMAIN}`);
  console.log(`🔗 Databricks Host: ${config.DATABRICKS_HOST}`);
  console.log(`🔑 Token: ${config.DATABRICKS_TOKEN ? config.DATABRICKS_TOKEN.substring(0, 10) + '...' : '未设置'}`);
  console.log(`📡 Telegram: ${config.CHAT_ID ? '已配置' : '未配置'}`);
  console.log(`📦 配置来源: ${JSON.stringify(config.source)}`);

  try {
    switch (action) {
      case 'check': {
        const result = await smartCheckAndStartApps(config);
        console.log('\n--- 检查结果 ---');
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'status': {
        await printAppsStatus(config);
        break;
      }

      case 'start': {
        const results = await startStoppedApps(config);
        console.log('\n--- 启动结果 ---');
        console.log(JSON.stringify(results, null, 2));
        break;
      }

      case 'test-notify': {
        const success = await testNotify(config);
        if (!success) {
          process.exit(1);
        }
        break;
      }

      default:
        console.error(`❌ 未知操作类型: ${action}`);
        console.log('可用操作: check, status, start, test-notify');
        process.exit(1);
    }

    console.log('\n✅ 监控任务完成');
  } catch (error) {
    console.error('\n❌ 监控任务失败:', error.message);
    console.error(error.stack);

    // 尝试发送错误通知
    try {
      const errorMsg = `❌ <b>Databricks 监控脚本运行失败</b>\n\n` +
        `💥 错误: <code>${error.message}</code>\n` +
        `⏰ 时间: ${new Date().toLocaleString('zh-CN')}\n` +
        `🏷️ 触发: GitHub Actions\n\n` +
        `🔧 请检查 GitHub Actions 日志`;
      await sendTelegramNotification(config, errorMsg);
    } catch {
      // 通知失败也不影响退出
    }

    process.exit(1);
  }
}

main();
