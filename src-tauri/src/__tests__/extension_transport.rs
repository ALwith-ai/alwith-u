use super::*;
use std::{
    io::{Read, Write},
    thread,
};

pub(crate) fn pair() -> (Stream, Stream) {
    let directory = tempfile::tempdir().unwrap();
    let identifier = format!("ai.alwith.test.{}", uuid::Uuid::new_v4());
    #[cfg(target_os = "macos")]
    {
        let _ = (&directory, &identifier);
        Stream::pair().unwrap()
    }
    #[cfg(windows)]
    {
        let mut listener = Listener::bind(directory.path(), &identifier).unwrap();
        let client = connect(&identifier).unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            match listener.accept() {
                Ok(server) => return (client, server),
                Err(error) if error.kind() == io::ErrorKind::WouldBlock && Instant::now() < deadline => {
                    thread::sleep(Duration::from_millis(5))
                }
                Err(error) => panic!("Cannot accept test connection: {error}"),
            }
        }
    }
}

#[test]
fn transport_exchanges_frames_between_verified_peers() {
    let (mut client, mut server) = pair();
    check_peer(&client).unwrap();
    check_peer(&server).unwrap();
    client.write_all(b"request\n").unwrap();
    let mut request = [0; 8];
    server.read_exact(&mut request).unwrap();
    assert_eq!(&request, b"request\n");
    server.write_all(b"result\n").unwrap();
    let mut result = [0; 7];
    client.read_exact(&mut result).unwrap();
    assert_eq!(&result, b"result\n");
}

#[test]
fn partial_input_does_not_reset_the_absolute_deadline() {
    let (client, mut server) = pair();
    let worker = thread::spawn(move || {
        server.write_all(b"a").unwrap();
        thread::sleep(Duration::from_millis(250));
        let _ = server.write_all(b"b");
    });
    let mut reader = DeadlineReader::new(client, Instant::now() + Duration::from_millis(100)).unwrap();
    let mut bytes = [0; 2];
    assert_eq!(reader.read_exact(&mut bytes).unwrap_err().kind(), io::ErrorKind::TimedOut);
    drop(reader);
    worker.join().unwrap();
}

#[cfg(windows)]
#[test]
fn pipe_names_are_application_scoped_and_cannot_be_claimed_twice() {
    let temp = tempfile::tempdir().unwrap();
    let id = format!("alwith-test-{}", uuid::Uuid::new_v4());
    let _listener = Listener::bind(temp.path(), &id).unwrap();
    assert!(Listener::bind(temp.path(), &id).is_err());
    assert!(connect(&format!("{id}-other")).is_err());
}

#[cfg(windows)]
#[test]
fn cancelling_a_read_does_not_corrupt_the_next_operation() {
    let (mut client, mut server) = pair();
    client.set_read_timeout(Some(Duration::from_millis(20))).unwrap();
    assert_eq!(client.read(&mut [0]).unwrap_err().kind(), io::ErrorKind::TimedOut);
    server.write_all(b"ok").unwrap();
    client.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
    let mut bytes = [0; 2];
    client.read_exact(&mut bytes).unwrap();
    assert_eq!(&bytes, b"ok");
}

#[cfg(windows)]
#[test]
fn idle_listener_remains_pending_and_can_be_closed_safely() {
    let temp = tempfile::tempdir().unwrap();
    let id = format!("alwith-test-{}", uuid::Uuid::new_v4());
    let mut listener = Listener::bind(temp.path(), &id).unwrap();
    assert_eq!(listener.accept().err().unwrap().kind(), io::ErrorKind::WouldBlock);
    drop(listener);
    let mut listener = Listener::bind(temp.path(), &id).unwrap();
    assert_eq!(listener.accept().err().unwrap().kind(), io::ErrorKind::WouldBlock);
    let client = connect(&id).unwrap();
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        match listener.accept() {
            Ok(_) => break,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock && Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(5))
            }
            Err(error) => panic!("Cannot accept after idle poll: {error}"),
        }
    }
    // Drop cancels the next pending connection, then releases its OVERLAPPED allocation.
    drop(client);
    drop(listener);
    assert!(Listener::bind(temp.path(), &id).is_ok());
}

#[cfg(windows)]
#[test]
fn listener_survives_clients_that_close_before_admission() {
    let temp = tempfile::tempdir().unwrap();
    let id = format!("alwith-test-{}", uuid::Uuid::new_v4());
    let mut listener = Listener::bind(temp.path(), &id).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let worker = thread::spawn(move || {
        while Instant::now() < deadline {
            match listener.accept() {
                Ok(mut stream) => {
                    let mut message = [0; 2];
                    match stream.read_exact(&mut message) {
                        Ok(()) => {
                            assert_eq!(&message, b"ok");
                            return;
                        }
                        Err(error)
                            if matches!(error.kind(), io::ErrorKind::UnexpectedEof | io::ErrorKind::BrokenPipe) => {}
                        Err(error) => panic!("Unexpected request error: {error}"),
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(1)),
                Err(error) => panic!("Listener stopped after client disconnect: {error}"),
            }
        }
        panic!("Listener did not accept the final request");
    });
    for index in 0..21 {
        let mut client = loop {
            match connect(&id) {
                Ok(client) => break client,
                Err(_) if Instant::now() < deadline => thread::sleep(Duration::from_millis(1)),
                Err(error) => panic!("Listener did not recover: {error}"),
            }
        };
        if index == 20 {
            client.write_all(b"ok").unwrap();
            worker.join().unwrap();
            return;
        }
    }
}
