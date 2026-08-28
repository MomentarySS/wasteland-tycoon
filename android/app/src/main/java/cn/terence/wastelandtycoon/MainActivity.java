package cn.terence.wastelandtycoon;

import android.media.AudioManager;
import android.os.Bundle;
import android.webkit.WebView;

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
  }
}
