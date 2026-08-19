package org.vetta.android.ui.remote

import android.annotation.SuppressLint
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

@SuppressLint("SetJavaScriptEnabled")
@Composable
actual fun RemoteDesktopSurface(target: String, modifier: Modifier) {
    AndroidView(
        modifier = modifier,
        factory = { context ->
            WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.mediaPlaybackRequiresUserGesture = false
                settings.cacheMode = WebSettings.LOAD_NO_CACHE
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                webChromeClient = WebChromeClient()
                setBackgroundColor(0xFF101010.toInt())
                tag = target
                loadDataWithBaseURL(
                    "http://vetta.local/",
                    viewerHtml(target),
                    "text/html",
                    "UTF-8",
                    null,
                )
            }
        },
        update = { view ->
            if (view.tag != target) {
                view.tag = target
                view.loadDataWithBaseURL("http://vetta.local/", viewerHtml(target), "text/html", "UTF-8", null)
            }
        },
    )
}

private fun viewerHtml(target: String): String {
    val escaped = target.replace("\\", "\\\\").replace("'", "\\'")
    return """
        <!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>html,body{margin:0;height:100%;background:#101010;overflow:hidden}video{width:100%;height:100%;object-fit:contain;touch-action:none}</style>
        <video id="screen" autoplay playsinline muted tabindex="0"></video>
        <script>
        (()=>{
          const target='$escaped', video=document.getElementById('screen');
          const hash=target.indexOf('#'), url=hash>=0?target.slice(0,hash):target, token=hash>=0?target.slice(hash+1):'';
          const sessionId=(url.match(/\/v1\/desktop\/([A-Za-z0-9_-]{24,128})\/viewer$/)||[])[1]; if(!sessionId)throw new Error('invalid desktop viewer target');
          const ws=new WebSocket(url, token?['vetta.desktop.v1','vetta.pairing.'+token]:['vetta.desktop.v1']);
          ws.onclose=()=>setTimeout(()=>location.reload(),1000);
          const pc=new RTCPeerConnection(); let input, seq=1, lastX=.5, lastY=.5; const pendingIce=[];
          const send=(m)=>ws.send(JSON.stringify(m)+'\\n');
          pc.onicecandidate=e=>{if(e.candidate)send({type:'ice',protocolVersion:1,sessionId,candidate:e.candidate.candidate,sdpMid:e.candidate.sdpMid,sdpMLineIndex:e.candidate.sdpMLineIndex})};
          pc.ontrack=e=>{video.srcObject=e.streams[0]||new MediaStream([e.track]);};
          pc.ondatachannel=e=>{if(e.channel.label==='vetta-input-v1'){input=e.channel;}};
          ws.onmessage=async e=>{for(const line of e.data.split('\\n').filter(Boolean)){const s=JSON.parse(line);if(s.type==='offer'){await pc.setRemoteDescription({type:'offer',sdp:s.sdp});while(pendingIce.length)await pc.addIceCandidate(pendingIce.shift());const a=await pc.createAnswer();await pc.setLocalDescription(a);send({type:'answer',protocolVersion:1,sessionId,sdp:a.sdp});}else if(s.type==='ice'){const ice={candidate:s.candidate,sdpMid:s.sdpMid,sdpMLineIndex:s.sdpMLineIndex};if(pc.remoteDescription)await pc.addIceCandidate(ice);else pendingIce.push(ice);}}};
          const sendInput=m=>{if(input&&input.readyState==='open')input.send(JSON.stringify({...m,sequence:seq++}));};
          const point=e=>{const r=video.getBoundingClientRect();lastX=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));lastY=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));sendInput({type:'pointer.move',x:lastX,y:lastY});};
          video.addEventListener('pointermove',point); video.addEventListener('pointerdown',e=>{video.focus();point(e);sendInput({type:'pointer.button',x:lastX,y:lastY,button:'left',action:'down'});}); video.addEventListener('pointerup',()=>sendInput({type:'pointer.button',x:lastX,y:lastY,button:'left',action:'up'}));
          video.addEventListener('wheel',e=>{e.preventDefault();sendInput({type:'pointer.scroll',deltaX:e.deltaX,deltaY:e.deltaY});},{passive:false});
          document.addEventListener('keydown',e=>{e.preventDefault();sendInput({type:'key',code:e.code,action:'down'});}); document.addEventListener('keyup',e=>{e.preventDefault();sendInput({type:'key',code:e.code,action:'up'});});
        })();
        </script>
    """.trimIndent()
}
