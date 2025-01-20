// 监听来自 Popup 的“startGrading”消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "startGrading") {
        const { submissions, config, gradingScale } = message;

        const parsedGradingScale = Number(gradingScale); // 确保分数制为数值型
        if (!Array.isArray(submissions) || submissions.length === 0) {
            console.error("[startGrading] 学生提交数据无效或为空！");
            sendResponse({ success: false, error: "学生提交数据无效或为空！" });
            return;
        }

        if (!parsedGradingScale || ![5, 100].includes(parsedGradingScale)) {
            console.error(`[startGrading] 无效的分数制: ${parsedGradingScale}`);
            sendResponse({ success: false, error: "无效的分数制！" });
            return;
        }

        if (!config || typeof config !== "object") {
            console.error("[startGrading] 配置数据无效！");
            sendResponse({ success: false, error: "配置数据无效！" });
            return;
        }

        console.log("[startGrading] 收到的评分配置:", config);
        console.log("[startGrading] 收到的分数制:", parsedGradingScale);
        console.log("[startGrading] 收到的学生提交数据:", submissions);

        try {
            // 对学生提交数据进行评分
            const gradedSubmissions = submissions.map((submission, index) => {
                console.log(`[startGrading] 处理学生 ${index + 1} 的提交数据...`);

                // 检查每个提交的文件有效性
                if (!submission.files || !Array.isArray(submission.files) || submission.files.length === 0) {
                    console.warn(`[startGrading] 学生 ${submission.studentId} 没有提交任何有效文件，评分为 0 分`);
                    return { ...submission, score: 0 };
                }

                // 计算分数
                try {
                    const score = calculateScore(submission, parsedGradingScale, config);
                    return { ...submission, score };
                } catch (error) {
                    console.error(`[startGrading] 学生 ${submission.studentId} 的评分失败:`, error.message);
                    return { ...submission, score: 0 }; // 如果评分失败，默认返回 0 分
                }
            });

            console.log("[startGrading] 评分结果:", gradedSubmissions);

            // 向前端更新评分结果
            chrome.runtime.sendMessage({
                action: "updateScores",
                submissions: gradedSubmissions,
                gradingScale: parsedGradingScale, // 传递数值型分数制
                config, // 评分配置
            });

            // 返回评分结果到 Popup
            sendResponse({ success: true, submissions: gradedSubmissions });
        } catch (error) {
            console.error("[startGrading] 评分失败:", error.message);
            sendResponse({ success: false, error: error.message });
        }
    }
});


// ============ 评分逻辑 ============

export function calculateScore(submission, gradingScale, config) {
    if (![5, 100].includes(gradingScale)) {
        console.warn(`[calculateScore] 未知的分数制: ${gradingScale}，默认使用 100`);
        gradingScale = 100;
    }

    console.log("[calculateScore] 当前分数制:", gradingScale);

    const files = submission.files || [];
    if (!files.length) {
        console.warn(`[calculateScore] 学生 ${submission.studentId} 没有提交任何文件`);
        return 0;
    }

    return calculateFileScores(files, Number(gradingScale), config);

}

function calculateFileScores(files, gradingScale, config){
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
    
    const hasPhoto = validFiles.some(file => /\.(jpg|jpeg|png)$/i.test(file.fileName));
    const hasVideo = validFiles.some(file => /\.(mp4|mov|avi)$/i.test(file.fileName));
    const hasCode = validFiles.some(file => /\.(ino|c|cpp|py|java)$/i.test(file.fileName));
    
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
    gradingScale = Number(gradingScale);
    if (!gradingScale || ![5, 100].includes(gradingScale)) {
    console.warn(`[getWeights] 无效的分数制: ${gradingScale}，默认使用 100`);
    gradingScale = 100; // 默认百分制
    }
        console.log(`[getWeights] 使用分数制: ${gradingScale}`);


    if (![1, 2, 3].includes(enabledOptions)) {
        console.warn(`未知的评分选项数: ${enabledOptions}，默认使用 3`);
        enabledOptions = 3; // 默认三选三
    }

    const weightMap = {
        100: {
            3: { photo: 20, video: 30, code: 50, full: 100 },
            2: { photo: 40, video: 40, code: 60, full: 100 },
            1: { photo: 100, video: 100, code: 100, full: 100 },
        },
        5: {
            3: { photo: 1, video: 1, code: 3, full: 5 },
            2: { photo: 2, video: 2, code: 3, full: 5 },
            1: { photo: 5, video: 5, code: 5, full: 5 },
        },
    };

    if (!weightMap[gradingScale] || !weightMap[gradingScale][enabledOptions]) {
        console.warn(`[getWeights] 无效的分数制 (${gradingScale}) 或选项数 (${enabledOptions})，返回默认权重`);
        return { photo: 0, video: 0, code: 0, full: 0 };
    }

    return weightMap[gradingScale][enabledOptions];
}







