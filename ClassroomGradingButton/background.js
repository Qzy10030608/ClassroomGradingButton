/*************************************************************************
 * background.js - 统一管理与 Google Classroom、Apps Script、Drive API 等通信
 * 并处理来自 popup.js / content script 的消息 (MV3, ES Module)
 *************************************************************************/

// 1) 以 ES 模块方式加载 data_manager.js
//    这会执行其中的代码并把 DataManager 挂到 globalThis.DataManager
import './data_manager.js';
import { calculateScore } from './grading_rules.js';
console.log("[background.js] DataManager =", globalThis.DataManager);
console.log("[background.js] GradingRules loaded");
// 全局变量，用于存储课程 ID
let decodedCourseId = null;

/*************************************************************************
 * 监听来自 Content Script 和 Popup 的消息
 *************************************************************************/
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("【background.js】收到的消息:", message, "来自:", sender);

  switch (message.action) {
      // 1) 设置课程ID并拉取作业
      case "setCourseId":
          handleSetCourseId(message, sendResponse);
          return true; // 使用异步

      // 2) 获取作业并返回：调用 DataManager.categorizeAssignments
      case "getCourseWork":
          handleGetCourseWork(message, sendResponse);
          return true;

      // 3) 获取某个作业的学生提交
      case "getStudentSubmissions":
          handleGetStudentSubmissions(message, sendResponse);
          return true;

      // 4) 打开标签页
      case "openTab":
          handleOpenTab(message, sendResponse);
          break;

      // 5) 获取 OAuth 令牌
      case "getAuthToken":
          handleGetAuthToken(sendResponse);
          break;

      // 6) 处理“评分”请求
      case "gradeAssignments":
          handleGradeAssignments(message, sendResponse);
          return true; // 标记异步处理

      // 7) 执行评分逻辑
      case "startGrading":
          handleStartGrading(message, sendResponse);
          return true; // 标记异步处理

      // 8) 发送分数：处理 submitGrades 消息
      case "submitGrades":
          handleSubmitGrades(message, sendResponse);
          return true; // 标记异步处理
      // 9) 其它可能的 action
      default:
          console.error("未知的消息操作:", message.action);
          sendResponse({ success: false, error: "未知的操作" });
          break;
  }

  return false; // 同步处理的默认返回
});


/*************************************************************************
 * handleSetCourseId - 设置课程 ID，并预先获取作业列表
 *************************************************************************/
async function handleSetCourseId(message, sendResponse) {
  const { decodedCourseId: newCourseId } = message;
  if (!newCourseId) {
    console.error("[handleSetCourseId] 未提供课程 ID");
    sendResponse({ success: false, error: "未提供课程 ID" });
    return;
  }

  try {
    if (!/^\d+$/.test(newCourseId)) {
      throw new Error("[handleSetCourseId] 收到的课程 ID 无效");
    }

    decodedCourseId = newCourseId; // 设置全局变量
    console.log(`[handleSetCourseId] 设置全局 decodedCourseId = ${decodedCourseId}`);

    // 存储到 Chrome Storage
    await chrome.storage.local.set({ decodedCourseId });
    console.log("[handleSetCourseId] 成功存储课程 ID 到 Storage:", decodedCourseId);

    sendResponse({ success: true });
  } catch (error) {
    console.error("[handleSetCourseId] 拉取或存储作业失败:", error);
    sendResponse({ success: false, error: error.message });
  }
}


/*************************************************************************
 * handleGetCourseWork - 读取本地作业并进行“出欠/作业”两分类后返回
 *************************************************************************/
async function handleGetCourseWork(message, sendResponse) {
  try {
      if (!decodedCourseId) {
          throw new Error("[handleGetCourseWork] 尚未设置 decodedCourseId");
      }

      const { assignments } = await DataManager.getAssignments(decodedCourseId);
      console.log("[handleGetCourseWork] 本地读取 assignments:", assignments);

      if (!assignments.length) {
          sendResponse({
              success: true,
              data: { attendance: [], assignments: [] },
              gradingScale: "100", // 默认百分制
          });
          return;
      }

      const categorized = await DataManager.categorizeAssignments(assignments);

      // 动态检测分数制
      const gradingScale = assignments.some(assignment => assignment.maxPoints === 5) ? "5" : "100";

      sendResponse({
        success: true,
        data: categorized,
        gradingScale: Number(gradingScale), // 确保为数值型
      });
  } catch (error) {
      console.error("[handleGetCourseWork] 异常:", error);
      sendResponse({ success: false, error: error.message });
  }
}


/*************************************************************************
 * handleGetStudentSubmissions - 获取某作业的所有学生提交
 *************************************************************************/
async function handleGetStudentSubmissions(message, sendResponse) {
  const { assignmentId } = message;
  if (!decodedCourseId) {
    sendResponse({ success: false, error: "课程 ID 未设置" });
    return;
  }
  if (!assignmentId) {
    sendResponse({ success: false, error: "作业 ID 未提供" });
    return;
  }

  try {
    const submissions = await fetchStudentSubmissions(decodedCourseId, assignmentId);
    sendResponse({ success: true, data: submissions });
  } catch (error) {
    console.error("[handleGetStudentSubmissions] 失败:", error);
    sendResponse({ success: false, error: error.message });
  }
}

/*************************************************************************
 * handleOpenTab - 打开一个新标签页
 *************************************************************************/
function handleOpenTab(message, sendResponse) {
  const { url } = message;

  if (!url) {
      sendResponse({ success: false, error: "未提供 URL" });
      return;
  }

  try {
      chrome.tabs.create({ url }, () => {
          if (chrome.runtime.lastError) {
              sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
              sendResponse({ success: true });
          }
      });
  } catch (error) {
      sendResponse({ success: false, error: error.message });
  }

  return true; // 保持消息通道打开
}
/**
 * handleGradeAssignments - 处理“评分”请求
 */
async function handleGradeAssignments(message, sendResponse) {
  console.log("[handleGradeAssignments] 收到评分配置:", message.config);

  try {
    // 确保课程 ID 和作业 ID 存在

    const assignmentId = message.assignmentId;
    if (!assignmentId) {
      throw new Error("作业 ID 未提供！");
    }

    const gradedSubmissions = message.gradedSubmissions || []; // 获取评分数据
    if (gradedSubmissions.length === 0) {
      throw new Error("未找到评分数据！");
    }

    // 构造要发送的数据
    const requestData = {
      action: "grade",
      decodedCourseId: decodedCourseId, 
      assignmentId: assignmentId,
      config: message.config,
      gradedSubmissions: gradedSubmissions, // 添加评分数据
    };

    // 发送到 Flask 服务器
    const serverResponse = await sendToServer(requestData);
    sendResponse(serverResponse);
  } catch (error) {
    console.error("[handleGradeAssignments] 失败:", error);
    sendResponse({ success: false, error: error.message });
  }
}
/**
 * sendToServer - 将请求发送到本地服务器
 * @param {Object} data - 需要发送的数据，包括课程 ID、作业 ID 和评分数据
 */
async function sendToServer(data) {
  const SERVER_URL = "http://localhost:5000/send_data";

  try {
    const token = await getAuthToken();
    if (!token) {
      throw new Error("未能获取有效的 OAuth 令牌！");
    }

    console.log("[sendToServer] 即将发送的数据:", data);

    // 将 token 添加到数据中
    const dataWithToken = {
      ...data,
      token, // 添加 token 字段
    };

    const response = await fetch(SERVER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(dataWithToken),
    });

    if (!response.ok) {
      throw new Error(`服务器错误: ${response.statusText} (状态码: ${response.status})`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(`服务器返回错误: ${result.error}`);
    }

    console.log("[sendToServer] 服务器响应:", result);
    return { success: true, data: result.response };
  } catch (error) {
    console.error("[sendToServer] 失败:", error.message);
    return { success: false, error: error.message };
  }
}


/*************************************************************************
 * Google Classroom / Drive 相关函数
 *************************************************************************/

// 获取某作业的所有学生提交
// background.js - 确保 fetchStudentSubmissions 返回正确格式
async function fetchStudentSubmissions(decodedCourseId, assignmentId) {
  try {
    const token = await getAuthToken();

    // 获取课程详情
    const courseUrl = `https://classroom.googleapis.com/v1/courses/${decodedCourseId}`;
    const courseResponse = await fetch(courseUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!courseResponse.ok) {
      throw new Error(`获取课程详情失败，状态码: ${courseResponse.status}`);
    }
    const courseData = await courseResponse.json();
    const title = courseData.name || `未知课程(${decodedCourseId})`;

    // 获取作业详情
    const assignmentData = await getAssignmentData(decodedCourseId, assignmentId, token);
    const gradingScale = Number(assignmentData.gradingScale) || 100; // 确保为数值
    console.log("[fetchStudentSubmissions] 当前分数制 gradingScale:", gradingScale);

    // 获取学生提交数据
    const submissions = await getAssignmentSubmissions(decodedCourseId, assignmentId, token);
    const students = await getCourseStudents(decodedCourseId, token);

    // 构建学生 ID 到名字的映射表
    const studentMap = Array.isArray(students)
      ? students.reduce((map, student) => {
          const userId = student.userId || "未知学号";
          const fullName = student.profile?.name?.fullName || "未知姓名";
          map[userId] = fullName;
          return map;
        }, {})
      : {};

    // 格式化提交数据
    const formattedSubmissions = submissions.map((submission) => {
      const studentId = submission.userId || "未知学号";
      const studentName = studentMap[submission.userId] || "未知姓名";
      const assignmentSubmission = submission.assignmentSubmission || {};
      const attachments = Array.isArray(assignmentSubmission.attachments) ? assignmentSubmission.attachments : [];
      const files = attachments.map((attachment) => ({
        fileName: attachment.driveFile?.title || "未知文件",
        fileLink: attachment.driveFile?.alternateLink || "#",
      })).filter(file => file.fileName && file.fileLink);

      return {
        studentId,
        studentName,
        files,
      };
    });

    console.log("[fetchStudentSubmissions] 格式化后的提交数据:", formattedSubmissions);

    return {
      title,
      gradingScale,
      submissions: formattedSubmissions,
    };
  } catch (error) {
    console.error("[fetchStudentSubmissions] 出现错误:", error.message);
    throw new Error(`获取学生提交数据失败: ${error.message}`);
  }
}

// 获取单个作业数据（包括分数制）
async function getAssignmentData(decodedCourseId, assignmentId, token) {
  const apiUrl = `https://classroom.googleapis.com/v1/courses/${decodedCourseId}/courseWork/${assignmentId}`;
  const response = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } });

  if (!response.ok) {
      throw new Error(`获取作业数据失败, 状态码=${response.status}`);
  }

  const data = await response.json();
  const maxPoints = data.maxPoints || 100;
  const gradingScale = Number(maxPoints) === 5 ? 5 : 100;

  console.log(`[getAssignmentData] 映射分数制: maxPoints=${maxPoints}, gradingScale=${gradingScale}`);
  return {
      ...data,
      gradingScale,
  };
}
// 获取学生提交记录
async function getAssignmentSubmissions(decodedCourseId, assignmentId, token) {
  const apiUrl = `https://classroom.googleapis.com/v1/courses/${decodedCourseId}/courseWork/${assignmentId}/studentSubmissions`;
  const response = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } });

  if (!response.ok) {
      throw new Error(`获取作业提交记录失败, 状态码=${response.status}, URL=${apiUrl}`);
  }

  const data = await response.json();
  return data.studentSubmissions || [];
}

// 获取课程学生信息
async function getCourseStudents(decodedCourseId, token) {
  const apiUrl = `https://classroom.googleapis.com/v1/courses/${decodedCourseId}/students`;
  const response = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } });

  if (!response.ok) {
      throw new Error(`获取课程学生信息失败, 状态码=${response.status}, URL=${apiUrl}`);
  }

  const data = await response.json();
  return data.students || [];
}

/*************************************************************************
 * handleStartGrading - 执行评分逻辑
 *************************************************************************/
async function handleStartGrading(message, sendResponse) {
  try {
    const { assignmentId, config } = message;

    if (!decodedCourseId) throw new Error("课程 ID 缺失！");
    if (!assignmentId) throw new Error("作业 ID 缺失！");
    if (!config) throw new Error("评分配置缺失！");

    // 从 fetchStudentSubmissions 获取数据和分数制
    const { gradingScale, submissions } = await fetchStudentSubmissions(decodedCourseId, assignmentId);

    console.log("[handleStartGrading] 使用的分数制:", gradingScale);
    console.log("[handleStartGrading] 获取到的学生提交数据:", submissions);

    if (!Array.isArray(submissions)) {
      throw new Error("[handleStartGrading] submissions 不是数组，无法评分！");
    }

    // 调用评分逻辑
    const gradedSubmissions = submissions.map((submission) => {
      if (!submission.files || !Array.isArray(submission.files) || submission.files.length === 0) {
          console.warn(`[startGrading] 学生 ${submission.studentId} 没有提交任何文件，评分为 0 分`);
          return { ...submission, score: 0 };
      }
  
      try {
          const score = calculateScore(submission, gradingScale, config);
          return { ...submission, score };
      } catch (error) {
          console.error(`[startGrading] 学生 ${submission.studentId} 的评分失败:`, error.message);
          return { ...submission, score: 0 }; // 如果评分失败，默认返回 0 分
      }
  });
  

    console.log("[handleStartGrading] 评分结果:", gradedSubmissions);

    // 将数据传递给前端，确保 gradingScale 是数值
    sendResponse({
      success: true,
      submissions: gradedSubmissions,
      gradingScale: Number(gradingScale),
    });    
  } catch (error) {
    console.error("[handleStartGrading] 出错:", error.message);
    sendResponse({ success: false, error: error.message });
  }

  return true; // 保持消息通道打开
}

async function handleSubmitGrades(message, sendResponse) {
  try {
    const { decodedCourseId, assignmentId, submissions } = message;

    // 检查数据完整性
    if (!decodedCourseId || !assignmentId || !submissions || submissions.length === 0) {
      throw new Error("课程 ID、作业 ID 或提交数据缺失");
    }

    // 获取作业的标题
    const assignmentData = await getAssignmentData(decodedCourseId, assignmentId, await getAuthToken());
    const title = assignmentData.title; // 直接从 assignmentData 中获取 title

    // 构造发送数据
    const data = {
      decodedCourseId,
      assignmentId,
      title, // 确保传递标题
      submissions,
    };

    // 调用 sendToServer 将数据发送到服务器
    const response = await sendToServer(data);
    sendResponse(response); // 将结果返回给 popup.js
  } catch (error) {
    console.error("[handleSubmitGrades] 出错:", error.message);
    sendResponse({ success: false, error: error.message });
  }
}


/*************************************************************************
 * 1. 获取 OAuth 令牌 (Promise 形式，方便 async/await)
 *************************************************************************/
async function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(
          new Error(
            "获取 token 失败: " + (chrome.runtime.lastError?.message || "")
          )
        );
      } else {
        console.log("[getAuthToken] 成功获取 token:", token);
        resolve(token);
      }
    });
  });
}
/*************************************************************************
 * handleGetAuthToken - 获取用户 OAuth 令牌
 *************************************************************************/
function handleGetAuthToken(sendResponse) {
  chrome.identity.getAuthToken({ interactive: true }, (token) => {
    if (chrome.runtime.lastError || !token) {
      console.error("[handleGetAuthToken] 获取 OAuth 令牌失败:", chrome.runtime.lastError);
      sendResponse({ success: false, error: "获取 OAuth 令牌失败" });
    } else {
      sendResponse({ success: true, token });
    }
  });
}