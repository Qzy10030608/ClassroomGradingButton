// data_manager.js
const DataManager = {
    /**
     * 通用方法：从 Chrome Storage 获取数据
     */
    async getFromStorage(key) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(key, (result) => {
                if (chrome.runtime.lastError) {
                    console.error(`[DataManager] getFromStorage失败: 键=${key}, 错误=${chrome.runtime.lastError.message}`);
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(result[key] || null);
                }
            });
        });
    },

    /**
     * 通用方法：存储数据到 Chrome Storage
     */
    async setToStorage(key, value) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.set({ [key]: value }, () => {
                if (chrome.runtime.lastError) {
                    console.error(`[DataManager] setToStorage失败: 键=${key}, 错误=${chrome.runtime.lastError.message}`);
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    console.log(`[DataManager] 已成功存储 => 键:${key}`);
                    resolve();
                }
            });
        });
    },

    // ---------------------------------------------------------------------
    // 1) 三分类: 照片(image) / 视频(video) / 代码(code)
    // ---------------------------------------------------------------------
    /**
     * 只分类成三类： image（照片）、video（视频）、code（代码）
     * @param {Array} courseworks - 作业数据(含 materials)
     * @param {string} token - OAuth 令牌(获取 Drive metadata)
     * @returns {Object} - { image:[], video:[], code:[] }
     */
    async classifyCourseworkFiles(courseworks, token) {
        const categorizedData = { image: [], video: [], code: [] };

        for (const cw of courseworks) {
            const materials = cw.materials || [];
            for (const material of materials) {
                const fileId = material.driveFile?.driveFile?.id;
                if (!fileId) {
                    console.warn("[DataManager] 材料缺少 fileId, 无法分类 => 跳过", cw);
                    continue;
                }

                try {
                    // 读Drive metadata
                    const fileMetadata = await this.fetchDriveFileMetadata(fileId, token);
                    const mimeType = fileMetadata.mimeType || "";
                    const fileName = fileMetadata.name || "";

                    // 判断三类:
                    if (mimeType.startsWith("image/")) {
                        categorizedData.image.push(cw);
                    } else if (mimeType.startsWith("video/")) {
                        categorizedData.video.push(cw);
                    } 
                    // 如果后缀匹配代码
                    else if (fileName.match(/\.(ino|c|cpp|py|java|js|ts|cs|go|rb)$/i)) {
                        categorizedData.code.push(cw);
                    }
                    // 其余类型不放进任何分类
                } catch (err) {
                    console.error(`[DataManager] 获取metadata失败, fileId=${fileId}`, err);
                }
            }
        }

        console.log("[DataManager] classifyCourseworkFiles => 三分类:", categorizedData);
        return categorizedData;
    },

    // ---------------------------------------------------------------------
    // 2) 存储作业 & 学生信息
    // ---------------------------------------------------------------------
    /**
     * 存储作业(原始) & 学生名字
     */
    async storeAssignments(decodedCourseId, assignments) {
        const assignmentsKey = `${decodedCourseId}_assignments`;
        const studentNamesKey = `${decodedCourseId}_studentNames`;
      
        const studentNames = {};
        const filteredAssignments = assignments.map((a) => ({
          id: a.id,                     // <-- 保留id
          title: a.title,
          maxPoints: a.maxPoints,
          dueDate: a.dueDate,
          description: a.description,
          materials: a.materials,
          studentId: a.studentId,       // 如果你有
          files: a.files,               // 如果你有
        }));
      
        await this.setToStorage(assignmentsKey, filteredAssignments);
        await this.setToStorage(studentNamesKey, studentNames);
        console.log(`[DataManager] 作业&学生名字已存 => ${assignmentsKey}, ${studentNamesKey}`);
      },

    /**
     * 从 Chrome Storage 获取作业 & 学生名字
     */
    async getAssignments(decodedCourseId) {
        const assignmentsKey = `${decodedCourseId}_assignments`;
        const studentNamesKey = `${decodedCourseId}_studentNames`;

        const assignments = await this.getFromStorage(assignmentsKey);
        const studentNames = await this.getFromStorage(studentNamesKey);
        console.log("[DataManager] getAssignments =>", { assignments, studentNames });

        return {
            assignments: assignments || [],
            studentNames: studentNames || {},
        };
    },

    // ---------------------------------------------------------------------
    // 3) 获取文件元数据
    // ---------------------------------------------------------------------
    /**
     * 读取 Drive 文件 (mimeType, name)
     */
    async fetchDriveFileMetadata(fileId, token) {
        const apiUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType,name`;
        const resp = await fetch(apiUrl, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) {
            throw new Error(`[DataManager] fetchDriveFileMetadata失败, 状态码=${resp.status}`);
        }
        return await resp.json();
    },

    // ---------------------------------------------------------------------
    // 4) 两分类：考勤 / 作业
    // ---------------------------------------------------------------------
    /**
     * 比如判断作业标题含 "出欠" 就算签到，否则算普通作业
     */
    async categorizeAssignments(assignments) {
        const result = { attendance: [], assignments: [] };
        for (const a of assignments) {
            if (a.title && a.title.includes("出欠")) {
                result.attendance.push(a);
            } else {
                result.assignments.push(a);
            }
        }
        console.log("[DataManager] categorizeAssignments =>", result);
        return result;
    },

    // ---------------------------------------------------------------------
    // 5) 上传/下载分类数据 (如果你需要)
    // ---------------------------------------------------------------------
    async uploadCategorizedDataToDrive(decodedCourseId, categorizedData, token) {
        const metadata = {
            name: `${decodedCourseId}_categorizedData.json`,
            mimeType: 'application/json',
        };

        const fileContent = JSON.stringify(categorizedData);
        const boundary = '-------314159265358979323846';
        const delimiter = `\r\n--${boundary}\r\n`;
        const closeDelimiter = `\r\n--${boundary}--`;

        const requestBody = 
            `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n`+
            `${JSON.stringify(metadata)}${delimiter}Content-Type: application/json\r\n\r\n`+
            `${fileContent}${closeDelimiter}`;

        const apiUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
        const resp = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body: requestBody,
        });

        if (!resp.ok) {
            const error = await resp.text();
            console.error("[DataManager] 上传到Drive失败:", error);
            throw new Error(`Google Drive上传失败, code=${resp.status}`);
        }
        const data = await resp.json();
        console.log("[DataManager] 上传成功, fileId=", data.id);
        return data.id;
    },

    async fetchCategorizedDataFromDrive(fileId, token) {
        const apiUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
        console.log("[DataManager] 从 Google Drive拉取分类数据, fileId=", fileId);

        const resp = await fetch(apiUrl, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) {
            const error = await resp.text();
            console.error("[DataManager] 拉取失败:", error);
            throw new Error(`Google Drive 拉取失败, code=${resp.status}`);
        }
        const data = await resp.json();
        console.log("[DataManager] 拉取成功 =>", data);
        return data;
    },

    // ---------------------------------------------------------------------
    // 6) 存储/读取 fileId
    // ---------------------------------------------------------------------
    async storeFileId(decodedCourseId, fileId) {
        await this.setToStorage(`${decodedCourseId}_fileId`, fileId);
        console.log(`[DataManager] 文件ID已存储 => 课程ID:${decodedCourseId}, fileId:${fileId}`);
    },

    async getFileId(decodedCourseId) {
        return await this.getFromStorage(`${decodedCourseId}_fileId`);
    },
};

// 挂载到 globalThis
globalThis.DataManager = DataManager;

