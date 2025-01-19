from flask import Flask, request, jsonify
from flask_cors import CORS
import requests

app = Flask(__name__)
CORS(app)  # 启用 CORS 支持

# Apps Script 的 Web App URL
APPS_SCRIPT_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxbMnGLN2m2FGwqfRauHPcPrOvJKQ-4Qr4ma48GeE0CDuMpOBS1lk5hSTWPN-8gnhr1/exec"

@app.route('/send_data', methods=['POST'])
def send_data():
    try:
        data = request.json
        if not data:
            app.logger.error("未接收到任何数据")
            return jsonify({"success": False, "error": "未接收到数据"}), 400

        decoded_course_id = data.get("decodedCourseId")
        assignment_id = data.get("assignmentId")
        title = data.get("title")  # 验证 title
        submissions = data.get("submissions")
        token = data.pop("token", None)

        # 验证缺少的字段
        missing_fields = []
        if not decoded_course_id:
            missing_fields.append("decodedCourseId")
        if not assignment_id:
            missing_fields.append("assignmentId")
        if not title:
            missing_fields.append("title")  # 验证标题
        if not submissions:
            missing_fields.append("submissions")
        if not token:
            missing_fields.append("token")

        if missing_fields:
            app.logger.error(f"缺少必要字段: {', '.join(missing_fields)}")
            return jsonify({"success": False, "error": f"缺少必要字段: {', '.join(missing_fields)}"}), 400

        app.logger.info(f"接收到的数据: {data}")

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

        response = requests.post(APPS_SCRIPT_WEB_APP_URL, json=data, headers=headers)
        if response.status_code != 200:
            app.logger.error(f"转发到 Apps Script 失败: {response.text}")
            return jsonify({"success": False, "error": response.text}), response.status_code

        app.logger.info(f"Apps Script 响应: {response.json()}")
        return jsonify({"success": True, "response": response.json()})
    except Exception as e:
        app.logger.error(f"发生异常: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500
if __name__ == '__main__':
    app.run(debug=True, port=5000)
