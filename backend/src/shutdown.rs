use std::{future::Future, time::Duration};

/// Install signal listeners before work starts so Docker's SIGTERM can be drained.
pub async fn signal() -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let mut terminate = signal(SignalKind::terminate())?;
        let mut interrupt = signal(SignalKind::interrupt())?;
        eprintln!("shutdown listener ready");
        tokio::select! {
            _ = terminate.recv() => {},
            _ = interrupt.recv() => {},
        }
        Ok(())
    }
    #[cfg(not(unix))]
    tokio::signal::ctrl_c().await
}

/// Finish a bounded tick once started; never cancel an ambiguous provider submission.
pub async fn drain_loop<S, F, Fut>(stop: S, delay: Duration, mut tick: F)
where
    S: Future<Output = ()>,
    F: FnMut() -> Fut,
    Fut: Future<Output = ()>,
{
    tokio::pin!(stop);
    loop {
        tokio::select! {
            biased;
            _ = &mut stop => break,
            _ = tokio::time::sleep(delay) => tick().await,
        }
    }
}
