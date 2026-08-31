package cn.terence.wastelandtycoon;

import android.media.AudioManager;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // 请求音频焦点，确保 WebView 音频/语音可正常播放
    try {
      AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
      if (am != null) {
        am.requestAudioFocus(
          focusChange -> { /* 忽略焦点变化，保持播放 */ },
          AudioManager.STREAM_MUSIC,
          AudioManager.AUDIOFOCUS_GAIN);
      }
    } catch (Throwable ignore) { /* 部分设备可能抛异常 */ }

    // 全屏沉浸模式：隐藏状态栏和导航栏
    hideSystemUI();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) {
      hideSystemUI();
    }
  }

  private void hideSystemUI() {
    View decorView = getWindow().getDecorView();
    WindowInsetsControllerCompat insetsController =
        WindowCompat.getInsetsController(getWindow(), decorView);
    if (insetsController != null) {
      // 隐藏状态栏和导航栏，滑动可临时显示
      insetsController.hide(WindowInsetsCompat.Type.systemBars());
      // 允许通过滑动暂时显示系统栏，3秒后自动隐藏
      insetsController.setSystemBarsBehavior(
          WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
    // 保持屏幕常亮
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  }
}
