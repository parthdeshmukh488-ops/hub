//! Leash windows (01-onchain-program §7.2): velocity, payee period and strikes.

use crate::errors::LeashError;

/// A window start and the counter that belongs to it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Window<T> {
    pub start: i64,
    pub counter: T,
}

/// Fixed-length windows that restart at the first event after the previous window ended; they
/// are not aligned to calendar time. A start of 0 means the window never started.
///
/// ```text
/// rolled(start, secs, counter, now):
///     if start == 0 or now >= start + secs:  return (now, 0)
///     else:                                  return (start, counter)
/// ```
///
/// `start + secs` beyond `i64` is `MathOverflow`, as in the SDK's `rollWindow`.
pub fn rolled<T: Copy + Default>(
    start: i64,
    secs: u32,
    counter: T,
    now: i64,
) -> Result<Window<T>, LeashError> {
    if start == 0 {
        return Ok(Window {
            start: now,
            counter: T::default(),
        });
    }
    let end = start
        .checked_add(i64::from(secs))
        .ok_or(LeashError::MathOverflow)?;
    Ok(if now >= end {
        Window {
            start: now,
            counter: T::default(),
        }
    } else {
        Window { start, counter }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_window_that_never_started_starts_now() {
        assert_eq!(
            rolled(0, 60, 7u16, 1_000),
            Ok(Window {
                start: 1_000,
                counter: 0
            })
        );
    }

    #[test]
    fn the_window_is_open_until_its_last_second() {
        assert_eq!(
            rolled(1_000, 60, 7u16, 1_059),
            Ok(Window {
                start: 1_000,
                counter: 7
            })
        );
        assert_eq!(
            rolled(1_000, 60, 7u16, 1_060),
            Ok(Window {
                start: 1_060,
                counter: 0
            })
        );
        assert_eq!(
            rolled(1_000, 60, 7u16, 5_000),
            Ok(Window {
                start: 5_000,
                counter: 0
            })
        );
    }

    #[test]
    fn an_end_beyond_i64_is_an_overflow() {
        assert_eq!(
            rolled(i64::MAX - 10, 60, 1u64, 0),
            Err(LeashError::MathOverflow)
        );
        assert!(rolled(i64::MAX - 60, 60, 1u64, 0).is_ok());
    }
}
