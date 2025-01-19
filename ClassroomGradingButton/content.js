// Content Script - 负责提取课程 ID 和动态添加按钮
window.onload = () => {
    console.log("Content script 加载成功");

    // 从 URL 提取课程 ID
    const courseIdMatch = window.location.href.match(/\/c\/([^\/]+)/);
    if (!courseIdMatch || !courseIdMatch[1]) {
        console.error("无法从 URL 提取课程 ID，请检查 URL 格式");
        return;
    }

    const rawCourseId = courseIdMatch[1];
    console.log("提取到的原始课程 ID:", rawCourseId);

    // 尝试 Base64 解码课程 ID
    let decodedCourseId;
    try {
        decodedCourseId = /^\d+$/.test(rawCourseId) ? rawCourseId : atob(rawCourseId); // 如果是数字则直接使用，否则解码
        console.log("解码后的课程 ID:", decodedCourseId);

        if (!/^\d+$/.test(decodedCourseId)) {
            throw new Error("解码后的课程 ID 格式无效");
        }
    } catch (error) {
        console.error("课程 ID 解码失败:", error.message);
        return;
    }

    // 发送解码后的课程 ID 到 Background
    chrome.runtime.sendMessage(
        { action: "setCourseId", decodedCourseId: decodedCourseId },
        (response) => {
            if (!response || !response.success) {
                console.error("课程 ID 发送失败，可能未正确存储到 Background");
            } else {
                console.log("课程 ID 成功发送到 Background:", decodedCourseId);
            }
        }
    );

    // 动态添加按钮到页面
    addPopupButton(decodedCourseId);
};

// 按钮点击事件处理
function handlePopupClick(decodedCourseId) {
    if (!decodedCourseId) {
        console.error("课程 ID 无效，无法跳转到 Popup 页面");
        return;
    }

    chrome.runtime.sendMessage(
        { action: "openTab", url: chrome.runtime.getURL(`popup.html?courseId=${decodedCourseId}`) },
        (response) => {
            try {
                // 捕获并忽略 chrome.runtime.lastError
                if (chrome.runtime.lastError) {
                    // 不记录错误日志
                    return;
                }

                if (response && response.success) {
                    console.log("Popup 页面已成功打开");
                } else {
                    // 不记录未必要的警告
                }
            } catch (error) {
                // 捕获意外异常
            }
        }
    );
}




// 动态添加按钮到页面
function addPopupButton(decodedCourseId) {
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'button-container'; // 使用定义好的样式类

    const openPopupButton = document.createElement('button');
    openPopupButton.id = 'open-popup-button';
    openPopupButton.className = 'popup-button'; // 使用定义好的按钮样式类
    openPopupButton.textContent = '批改作业';

    buttonContainer.appendChild(openPopupButton);
    document.body.appendChild(buttonContainer);

    console.log("动态按钮已添加到页面");

    // 设置按钮点击事件
    openPopupButton.addEventListener('click', () => handlePopupClick(decodedCourseId));
}




