use event_confirm_api::shutdown::drain_loop;
use std::{cell::Cell, rc::Rc, time::Duration};
use tokio::sync::oneshot;

#[ntex::test]
async fn shutdown_drains_current_tick_and_never_starts_another() {
    let (stop_tx, stop_rx) = oneshot::channel();
    let (entered_tx, entered_rx) = oneshot::channel();
    let (release_tx, release_rx) = oneshot::channel();
    let completed = Rc::new(Cell::new(false));
    let finished = completed.clone();
    let mut entered = Some(entered_tx);
    let mut release = Some(release_rx);
    let task = ntex::rt::spawn(async move {
        drain_loop(
            async {
                let _ = stop_rx.await;
            },
            Duration::from_millis(1),
            || {
                let entered = entered.take().expect("no new tick after shutdown");
                let release = release.take().unwrap();
                let finished = finished.clone();
                async move {
                    entered.send(()).unwrap();
                    release.await.unwrap();
                    finished.set(true);
                }
            },
        )
        .await;
    });
    entered_rx.await.unwrap();
    stop_tx.send(()).unwrap();
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(!completed.get());
    release_tx.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(1), task)
        .await
        .unwrap()
        .unwrap();
    assert!(completed.get());
}

#[ntex::test]
async fn already_requested_shutdown_does_not_claim_work() {
    drain_loop(async {}, Duration::ZERO, || async {
        panic!("shutdown must win before claiming another call");
    })
    .await;
}
