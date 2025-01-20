
// --------------------- 全局变量 ---------------------
let cachedCategorizedData = null;  // 用于存储 { attendance:[], assignments:[], submissions:[] }
let decodedCourseId = null;        // 课程ID（全局声明，不要再在别处 const）
let pageStack = [];                // 页面堆栈
let assignmentId = null;
// --------------------- 页面加载事件 ---------------------
document.addEventListener('DOMContentLoaded', async () => {
    console.log("Popup 页面加载成功");

    try {
        showLoadingSpinner();

        // 1. 获取 decodedCourseId
        decodedCourseId = await getDecodedCourseIdFromStorage();
        if (!decodedCourseId) {
            console.error("未找到课程 ID");
            renderError("课程 ID 未找到，请返回主页面重新加载。");
            return;
        }
        console.log("成功获取课程 ID:", decodedCourseId);

        // 2. 从 Background.js 加载作业数据
        await loadCategoryData(decodedCourseId);
        if (cachedCategorizedData) {
            console.log("成功加载分类数据:", cachedCategorizedData);
            renderCategoryOptions(cachedCategorizedData);
            navigateTo("all", renderAllDetails, cachedCategorizedData);
        } else {
            console.error("分类数据为空");
            renderError("分类数据加载失败，请稍后重试。");
        }
    } catch (error) {
        console.error("初始化失败:", error);
        renderError("无法加载课程或作业数据，请检查网络连接或重试。");
    } finally {
        hideLoadingSpinner();
    }
});


// --------------------- 获取存储中的课程ID ---------------------
async function getDecodedCourseIdFromStorage() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get("decodedCourseId", (result) => {
            if (chrome.runtime.lastError) {
                console.error("获取 decodedCourseId 失败:", chrome.runtime.lastError.message);
                reject(chrome.runtime.lastError.message);
            } else {
                resolve(result.decodedCourseId || null);
            }
        });
    });
}

// --------------------- 加载分类数据 ---------------------
async function loadCategoryData(decodedCourseId) {
    showLoadingSpinner();
    try {
        if (!cachedCategorizedData) {
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage(
                    { action: "getCourseWork", decodedCourseId },
                    resolve
                );
            });

            if (response.success && response.data) {
                const data = response.data;

                if (Array.isArray(data.attendance) && Array.isArray(data.assignments)) {
                    cachedCategorizedData = { ...data, submissions: [] };
                    console.log("分类数据加载成功:", cachedCategorizedData);

                    // 缓存分数制
                    const gradingScale = Number(data.gradingScale) || 100;
                    localStorage.setItem("currentGradingScale", gradingScale);
                    console.log("当前分数制:", gradingScale);
                } else {
                    console.error("分类数据格式错误:", data);
                    renderError("分类数据格式错误，请稍后重试。");
                }
            } else {
                console.error("分类数据加载失败:", response.error || "未知错误");
                renderError("无法加载分类数据，请稍后重试。");
            }
        }

        // 此处只打印缓存中的分数制，避免重复定义
        console.log(
            "当前分数制 (缓存):",
            localStorage.getItem("currentGradingScale") || 100
        );
    } catch (error) {
        console.error("加载分类数据时出现错误:", error);
        renderError("无法加载分类数据，请稍后重试。");
    } finally {
        hideLoadingSpinner();
    }
}


// --------------------- 渲染顶部的按钮：全部 / 签到 / 作业 ---------------------
function renderCategoryOptions(cData) {
    if (!cData || !cData.attendance || !cData.assignments) {
        console.error("无效的分类数据:", cData);
        renderError("无法加载分类数据，请稍后重试。");
        return;
    }
    const btnContainer = document.getElementById("buttons-container");
    btnContainer.innerHTML = '';

    const totalCount      = cData.attendance.length + cData.assignments.length;
    const attendanceCount = cData.attendance.length;
    const assignmentCount = cData.assignments.length;

    // 要生成的按钮
    const buttonData = [
        {
            id: "all-button",
            text: `全部 (${totalCount})`,
            handler: () => navigateTo("all", renderAllDetails, cData),
        },
        {
            id: "attendance-button",
            text: `签到 (${attendanceCount})`,
            handler: () => navigateTo("attendance", renderAttendanceDetails, cData.attendance),
        },
        {
            id: "assignments-button",
            text: `作业 (${assignmentCount})`,
            handler: () => navigateTo("assignments", renderAssignmentsDetails, cData.assignments),
        },
    ];

    // 依次生成按钮并挂载
    buttonData.forEach(({ id, text, handler }) => {
        const btn = document.createElement("button");
        btn.id = id;
        btn.textContent = text;
        btn.addEventListener("click", handler);
        btnContainer.appendChild(btn);
    });

    // 初始时隐藏“返回”按钮
    document.getElementById("return-button").style.display = "none";
}

// --------------------- 通用页面切换函数 ---------------------
function navigateTo(page, renderFunction, data) {
    showLoadingSpinner(); // 显示加载动画
    clearAssignmentsContainer();
    renderFunction(data);
    pageStack.push(page);
    history.pushState({ page }, '', `#${page}`);

    const btnContainer    = document.getElementById("buttons-container");
    const returnButton    = document.getElementById("return-button");
    const gradingControls = document.getElementById("grading-controls");
    const gradingOptions  = document.getElementById("grading-options");

    // 先统一都隐藏：顶部按钮、返回按钮、批改控件
    btnContainer.style.display    = "none";
    returnButton.style.display    = "none";
    gradingControls.style.display = "none";
    gradingOptions.style.display  = "none";

    if (page === "all") {
        // 图3: 显示顶部三个按键，隐藏返回按钮
        btnContainer.style.display = "block";
        // returnButton.style.display = "none"; // 默认就是none了，所以省略也行
    } else if (page === "attendance" || page === "assignments") {
        // 图1 & 图2: 隐藏顶部三个按键，显示返回按钮
        returnButton.style.display = "inline-block";
    } else if (page === "submissions") {
        // 显示返回按钮、显示“开始批改”按钮
        returnButton.style.display = "inline-block";
        gradingControls.style.display = "block";
        // gradingOptions 还是默认隐藏，只有点击“开始批改”时才显示
    } else {
        console.warn("navigateTo: 未知页面 ->", page);
    }
    // 隐藏加载动画
    hideLoadingSpinner();
}


// --------------------- “返回”按钮点击 ---------------------
document.getElementById("return-button").addEventListener("click", () => {
    console.log("点击返回按钮");
    if (pageStack.length > 1) {
        pageStack.pop();
        const prevPage = pageStack[pageStack.length - 1];

        switch (prevPage) {
            case "all":
                navigateTo("all", renderAllDetails, cachedCategorizedData);
                break;
            case "attendance":
                navigateTo("attendance", renderAttendanceDetails, cachedCategorizedData.attendance);
                break;
            case "assignments":
                navigateTo("assignments", renderAssignmentsDetails, cachedCategorizedData.assignments);
                break;
            case "submissions":
                // 如果要回到之前获取的学生提交
                navigateTo("submissions", renderStudentSubmissions, cachedCategorizedData.submissions || []);
                break;
            default:
                console.warn("未知页面:", prevPage, "回到 all");
                navigateTo("all", renderAllDetails, cachedCategorizedData);
        }
    } else {
        // 栈只有1页 -> 回到 “all”
        pageStack = ["all"];
        document.getElementById("buttons-container").style.display = "block";
        document.getElementById("return-button").style.display = "none";
        clearAssignmentsContainer();
        renderAllDetails(cachedCategorizedData);
    }
});

// --------------------- 监听浏览器后退 ---------------------
window.addEventListener("popstate", () => {
    console.log("popstate event");
    if (pageStack.length > 1) {
        pageStack.pop();
        const prevPage = pageStack[pageStack.length - 1];
        switch (prevPage) {
            case "all":
                navigateTo("all", renderAllDetails, cachedCategorizedData);
                break;
            case "attendance":
                navigateTo("attendance", renderAttendanceDetails, cachedCategorizedData.attendance);
                break;
            case "assignments":
                navigateTo("assignments", renderAssignmentsDetails, cachedCategorizedData.assignments);
                break;
            case "submissions":
                navigateTo("submissions", renderStudentSubmissions, cachedCategorizedData.submissions || []);
                break;
            default:
                console.warn("popstate -> unknown:", prevPage);
                navigateTo("all", renderAllDetails, cachedCategorizedData);
        }
    } else {
        pageStack = ["all"];
        document.getElementById("buttons-container").style.display = "block";
        document.getElementById("return-button").style.display = "none";
        clearAssignmentsContainer();
        renderAllDetails(cachedCategorizedData);
    }
});

// --------------------- 渲染页面：全部 ---------------------
function renderAllDetails() {
    const container = document.getElementById("assignments-container");
    container.innerHTML = "<h3>全部内容</h3>";

    if (!cachedCategorizedData) {
        console.error("未找到分类数据");
        renderError("未找到分类数据，请稍后重试。");
        return;
    }

    const allData = [
        ...cachedCategorizedData.attendance,
        ...cachedCategorizedData.assignments
    ];

    allData.forEach(item => {
        const div = document.createElement("div");
        div.textContent = item.title || "未知标题";
        container.appendChild(div);
    });
}

// --------------------- 渲染页面：签到(出欠) ---------------------
function renderAttendanceDetails(attendanceData) {
    console.log("签到详情数据：", attendanceData);
    const container = document.getElementById('assignments-container');
    container.innerHTML = '<h3>签到详情</h3>';

    attendanceData.forEach((item) => {
        const div = document.createElement('div');
        div.textContent = item.title || "未知签到标题";
        container.appendChild(div);
    });

    // === 手动添加一个“返回”按钮 ===
    const backBtn = document.createElement('button');
    backBtn.textContent = '返回';
    backBtn.style.backgroundColor = '#28A745'; // 你可以自己调样式
    backBtn.addEventListener('click', () => {
        // 这里你可以自己决定点击后要去哪个页面
        // 比如回到 “all”：
        navigateTo("all", renderAllDetails, cachedCategorizedData);
    });
    container.appendChild(backBtn);
}

// --------------------- 渲染页面：作业 ---------------------
function renderAssignmentsDetails(assignmentsData) {
    console.log("作业详情数据：", assignmentsData);
    const container = document.getElementById('assignments-container');
    container.innerHTML = '<h3>作业详情</h3>';

    assignmentsData.forEach((assignment) => {
        const div = document.createElement('div');
        div.innerHTML = `
            <div>
                <span>作业标题: ${assignment.title || "未知标题"}</span>
                <button>查看提交</button>
            </div>
        `;
        const button = div.querySelector('button');
        // 点击后 -> getStudentSubmissions
        button.addEventListener('click', () => handleAssignmentClick(assignment.id));
        container.appendChild(div);
    });

    // === 手动添加一个“返回”按钮 ===
    const backBtn = document.createElement('button');
    backBtn.textContent = '返回';
    backBtn.style.backgroundColor = '#28A745';
    backBtn.addEventListener('click', () => {
        // 返回到 “all” 或者你想要的页面
        navigateTo("all", renderAllDetails, cachedCategorizedData);
    });
    container.appendChild(backBtn);
}

// --------------------- 点击“查看提交” -> 后台获取学生提交 -> 跳转 submissions ---------------------
function handleAssignmentClick(assignmentId) {
    const title = cachedCategorizedData.assignments.find(a => a.id === assignmentId)?.title || "未知标题";
    console.log("点击查看提交，设置 assignmentId:", assignmentId, "和 title:", title);

    localStorage.setItem("currentAssignmentId", assignmentId); // 缓存作业ID
    localStorage.setItem("currentAssignmentTitle", title); // 缓存作业标题

    chrome.runtime.sendMessage(
        { action: "getStudentSubmissions", decodedCourseId, assignmentId },
        (response) => {
            if (response.success && Array.isArray(response.data?.submissions)) {
                cachedCategorizedData.submissions = response.data.submissions;

                // 获取并存储分数制
                const gradingScale = Number(response.data.gradingScale) || 100; // 确保 gradingScale 是数值型
                localStorage.setItem("currentGradingScale", gradingScale); // 缓存分数制
                console.log("[handleAssignmentClick] 当前分数制:", gradingScale);

                // 渲染学生提交页面
                navigateTo("submissions", renderStudentSubmissions, response.data.submissions);
            } else {
                console.error("获取学生提交数据失败:", response.error);
                alert("获取学生提交数据失败，请稍后重试！");
            }
        }
    );
}


// --------------------- 返回按钮逻辑 ---------------------
function renderStudentSubmissions(submissions, gradingScale) {
    if (!Array.isArray(submissions)) {
        console.error("submissions 数据格式错误:", submissions);
        renderError("学生提交数据加载失败，请稍后重试。");
        return;
    }

    gradingScale = Number(gradingScale) || 100; // 确保 gradingScale 为数值类型

    const container = document.getElementById('assignments-container');
    container.innerHTML = `
        <h3>学生提交的作业</h3>
        <table id="submissions-table" border="1" style="width: 100%; text-align: left; border-collapse: collapse;">
            <thead>
                <tr>
                    <th>名字</th>
                    <th>照片</th>
                    <th>视频</th>
                    <th>代码</th>
                    <th>分数</th>
                </tr>
            </thead>
            <tbody></tbody>
        </table>
    `;
    const tableBody = container.querySelector('#submissions-table tbody');

    submissions.forEach((submission) => {
        const files = Array.isArray(submission.files) ? submission.files : [];
        const photoLinks = files
            .filter(file => file.fileName && file.fileName.match(/\.(jpg|jpeg|png)$/i))
            .map(file => `<a href="${file.fileLink}" target="_blank">${file.fileName}</a>`)
            .join(', ') || '无';

        const videoLinks = files
            .filter(file => file.fileName && file.fileName.match(/\.(mp4|mov|avi)$/i))
            .map(file => `<a href="${file.fileLink}" target="_blank">${file.fileName}</a>`)
            .join(', ') || '无';

        const codeLinks = files
            .filter(file => file.fileName && file.fileName.match(/\.(ino|c|cpp|py|java)$/i))
            .map(file => `<a href="${file.fileLink}" target="_blank">${file.fileName}</a>`)
            .join(', ') || '无';

            const gradingScale = Number(localStorage.getItem("currentGradingScale")) || 100; // 确保是数值型
            const displayScore = gradingScale === 5
                ? `${submission.score} / 5`
                : `${submission.score} / 100`;
            

        const row = `
            <tr>
                <td>${submission.studentName || '未知名字'}</td>
                <td>${photoLinks}</td>
                <td>${videoLinks}</td>
                <td>${codeLinks}</td>
                <td class="score" data-student-id="${submission.studentId}">${displayScore}</td>
            </tr>
        `;

        tableBody.insertAdjacentHTML('beforeend', row);
    });
}


// 点击“开始批改”按钮
document.getElementById("start-grading-button").addEventListener("click", () => {
    const gradingOptions = document.getElementById("grading-options");
    const gradingTitle = document.getElementById("grading-title");

    gradingTitle.textContent = "评分配置"; // 设置标题
    gradingOptions.style.display = "block"; // 显示评分配置区域

    window.scrollTo(0, document.body.scrollHeight); // 滚动到评分配置区域
});

// 点击“开始评分”按钮
document.getElementById("auto-grade-button").addEventListener("click", () => {
    const assignmentId = localStorage.getItem("currentAssignmentId");
    if (!assignmentId) {
        alert("未找到作业 ID，请返回并重新选择作业！");
        return;
    }

    const config = getGradingConfig();
    if (!config.requirePhoto && !config.requireVideo && !config.requireCode) {
        alert("请至少选择一个评分配置！");
        return;
    }

    const submissions = cachedCategorizedData.submissions || [];
    if (submissions.length === 0) {
        alert("未找到学生提交记录，请确认数据！");
        return;
    }

    const gradingScale = Number(localStorage.getItem("currentGradingScale")) || 100; // 确保数值型
    console.log("[popup.js] 当前传递的分数制:", gradingScale);

    chrome.runtime.sendMessage(
        {
            action: "startGrading",
            assignmentId,
            submissions,
            gradingScale,
            config,
        },
        (response) => {
            if (response && response.success) {
                console.log("[popup.js] 评分成功:", response.submissions);
                processGrading(response.submissions, gradingScale);
            } else {
                console.error("[popup.js] 评分失败:", response?.error);
                alert("评分失败，请检查后台日志！");
            }
        }
    );
});


// 实时更新分数到页面
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "updateScores") {
        const updatedSubmissions = message.submissions || [];
        const gradingScale = Number(message.gradingScale) || 100; // 确保是数值型
        updatedSubmissions.forEach((submission) => {
            const scoreElement = document.querySelector(`.score[data-student-id="${submission.studentId}"]`);
            if (scoreElement) {
                const displayScore = gradingScale === 5
                    ? `${submission.score} / 5`
                    : `${submission.score} / 100`;
                scoreElement.textContent = displayScore;
            }
        });
        sendResponse({ success: true });
    }
});



// 提取评分配置
function getGradingConfig() {
    const config = {
        requirePhoto: document.getElementById("require-photo").checked,
        requireVideo: document.getElementById("require-video").checked,
        requireCode: document.getElementById("require-code").checked,
    };

    console.log("[getGradingConfig] 当前评分配置:", config);
    return config;
}

// 处理评分结果
// 在 processGrading 函数中同步评分结果到 cachedCategorizedData
function processGrading(submissions, gradingScale) {
    console.log("[processGrading] 使用分数制:", gradingScale);

    submissions.forEach((submission) => {
        const scoreElement = document.querySelector(`.score[data-student-id="${submission.studentId}"]`);
        if (scoreElement) {
            const displayScore = gradingScale === 5 ? `${submission.score} / 5` : `${submission.score} / 100`;
            scoreElement.textContent = displayScore;
        }
    });

    // 同步更新 cachedCategorizedData.submissions
    cachedCategorizedData.submissions = submissions;

    alert("评分已完成，页面已更新！");
}

// 点击“发送分数”按钮
document.getElementById("submit-grades-button").addEventListener("click", () => {
    const submissions = cachedCategorizedData.submissions || [];
    if (submissions.length === 0) {
        alert("未找到学生提交记录，请确认数据！");
        return;
    }

    const gradedSubmissions = submissions.map(submission => ({
        studentName: submission.studentName || "未知学生",
        score: submission.score || 0, // 使用评分后的分数
        files: submission.files,     // 确保文件也被包含
    }));

    // 发送到 Background
    sendGradingConfig("submitGrades", gradedSubmissions);
});


// 调整 sendGradingConfig 方法以支持发送分数
async function sendGradingConfig(action, gradedSubmissions) {
    try {
        const assignmentId = localStorage.getItem("currentAssignmentId");
        const title = localStorage.getItem("currentAssignmentTitle"); // 使用 title

        if (!assignmentId || !title) {
            alert("未找到作业 ID 或标题，请返回并重新选择作业！");
            console.error("assignmentId 或 title 未找到");
            return;
        }

        const message = {
            action,
            decodedCourseId,
            assignmentId,
            title, // 确保传递 title
            submissions: gradedSubmissions.map((submission) => ({
                studentName: submission.studentName,
                score: submission.score,
            })),
        };

        chrome.runtime.sendMessage(message, (response) => {
            if (response && response.success) {
                alert("分数已成功发送！");
            } else {
                console.error("发送分数失败：", response?.error);
                alert("发送失败，请稍后重试！");
            }
        });
    } catch (error) {
        console.error("发送分数时发生错误:", error);
        alert("发送分数时发生错误，请稍后重试！");
    }
}


// --------------------- 辅助函数 ---------------------
function clearAssignmentsContainer() {
    const container = document.getElementById('assignments-container');
    if (container) container.innerHTML = '';
}

function showLoadingSpinner() {
    const spinner = document.getElementById('loading-spinner');
    if (spinner) spinner.style.display = 'block';
}

function hideLoadingSpinner() {
    const spinner = document.getElementById('loading-spinner');
    if (spinner) spinner.style.display = 'none';
}

function renderError(message) {
    const container = document.getElementById('assignments-container');
    if (container) {
        container.innerHTML = `<p style="color: red;">${message}</p>`;
    }
}



