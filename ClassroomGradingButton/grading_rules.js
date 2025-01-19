// 监听来自 Popup 的“startGrading”消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "startGrading") {
        const { submissions, config, gradingScale } = message;

        if (!submissions || submissions.length === 0) {
            console.error("没有学生提交数据，无法评分！");
            sendResponse({ success: false, error: "没有学生提交数据！" });
            return;
        }

        if (!gradingScale) {
            console.error("分数制缺失，无法评分！");
            sendResponse({ success: false, error: "分数制缺失！" });
            return;
        }

        console.log("评分配置:", config);
        console.log("分数制:", gradingScale);
        console.log("接收到的 submissions 数据:", submissions);

        try {
            const gradedSubmissions = submissions.map((submission, index) => {
                console.log(`学生 ${index + 1} 提交的文件:`, submission.files);

                if (!submission.files || !Array.isArray(submission.files) || submission.files.length === 0) {
                    console.warn(`学生 ${submission.studentId} 没有提交任何有效文件，评分为 0 分`);
                    return { ...submission, score: 0 };
                }

                const score = calculateScore(submission, gradingScale, config);
                return { ...submission, score };
            });

            console.log("评分结果:", gradedSubmissions);

            chrome.runtime.sendMessage({
                action: "updateScores",
                submissions: gradedSubmissions,
                gradingScale, // 分数制
                config,       // 评分配置
            });

            sendResponse({ success: true, submissions: gradedSubmissions });
        } catch (error) {
            console.error("评分失败:", error);
            sendResponse({ success: false, error: error.message });
        }
    }
});

// ============ 评分逻辑 ============

export function calculateScore(submission, gradingScale, config) {
    const weights = getWeights(gradingScale); // 获取权重
    const baseScore = gradingScale === "100" ? 100 : 5; // 根据分数制设置满分

    // 确保 submission.files 存在且是一个数组
    if (!submission.files || !Array.isArray(submission.files)) {
        console.warn(`学生 ${submission.studentId} 的提交文件格式不正确，评分为 0 分`);
        return 0;
    }

    const files = submission.files;

    if (files.length === 0) {
        console.warn(`学生 ${submission.studentId} 没有提交任何文件，评分为 0 分`);
        return 0;
    }

    return calculateFileScores(files, gradingScale, config);
}

function calculateFileScores(files, gradingScale, config) {
    if (!config || typeof config !== "object") {
        console.warn("评分配置无效，默认返回 0 分");
        return 0;
    }

    // 检查文件结构
    if (!Array.isArray(files) || files.length === 0) {
        console.warn("学生提交的文件数据无效或为空");
        return 0;
    }

    const validFiles = files.filter(file => typeof file.fileName === "string" && file.fileName.trim() !== "");
    if (validFiles.length === 0) {
        console.warn("学生提交的文件数据中没有有效文件");
        return 0;
    }

    const hasPhoto = validFiles.some(file => file.fileName.match(/\.(jpg|jpeg|png)$/i));
    const hasVideo = validFiles.some(file => file.fileName.match(/\.(mp4|mov|avi)$/i));
    const hasCode = validFiles.some(file => file.fileName.match(/\.(py|java|cpp|ino)$/i));

    // 确定评分模式（三选三、三选二、三选一）
    const enabledOptions = [
        config.requirePhoto ? "photo" : null,
        config.requireVideo ? "video" : null,
        config.requireCode ? "code" : null,
    ].filter(Boolean).length;

    if (!enabledOptions) {
        console.warn("评分配置未启用任何条件，评分为 0 分");
        return 0;
    }

    const weights = getWeights(gradingScale, enabledOptions); // 动态获取权重
    let totalScore = 0;

    // 根据启用的评分模式计算分数
    if (enabledOptions === 3) {
        if (config.requireCode && hasCode) totalScore += weights.code;
        if (config.requireVideo && hasVideo) totalScore += weights.video;
        if (config.requirePhoto && hasPhoto) totalScore += weights.photo;
    } else if (enabledOptions === 2) {
        if (config.requireCode && hasCode) totalScore += weights.code;
        if (config.requireVideo && hasVideo) totalScore += weights.video;
        else if (config.requirePhoto && hasPhoto) totalScore += weights.photo;
    } else if (enabledOptions === 1) {
        if ((config.requireCode && hasCode) || (config.requireVideo && hasVideo) || (config.requirePhoto && hasPhoto)) {
            totalScore = weights.full;
        }
    }

    return Math.min(totalScore, weights.full); // 确保分数不超过满分
}

// 根据评分制和选项数动态调整权重
function getWeights(gradingScale, enabledOptions) {
    // 检查 gradingScale 是否为合法值
    if (!["100", "5"].includes(gradingScale)) {
        console.warn(`未知的评分制: ${gradingScale}，默认使用 "100"`);
        gradingScale = "100"; // 默认使用百分制
    }

    // 检查 enabledOptions 是否为合法值
    if (![1, 2, 3].includes(enabledOptions)) {
        console.warn(`未知的评分选项数: ${enabledOptions}，默认使用 3`);
        enabledOptions = 3; // 默认使用三选三
    }

    // 根据评分制和选项数返回权重
    if (gradingScale === "100") {
        if (enabledOptions === 3) {
            return { photo: 20, video: 30, code: 50, full: 100 };
        } else if (enabledOptions === 2) {
            return { photo: 40, video: 40, code: 60, full: 100 };
        } else if (enabledOptions === 1) {
            return { photo: 100, video: 100, code: 100, full: 100 };
        }
    } else if (gradingScale === "5") {
        if (enabledOptions === 3) {
            return { photo: 1, video: 1, code: 3, full: 5 };
        } else if (enabledOptions === 2) {
            return { photo: 2, video: 2, code: 3, full: 5 };
        } else if (enabledOptions === 1) {
            return { photo: 5, video: 5, code: 5, full: 5 };
        }
    }

    // 再次兜底，返回默认权重
    console.warn(`未知情况，返回默认权重`);
    return { photo: 0, video: 0, code: 0, full: 0 };
}




