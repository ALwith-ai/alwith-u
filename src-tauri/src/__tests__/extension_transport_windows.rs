use super::*;

#[test]
fn control_directory_has_explicit_user_owner_and_no_inherited_access() {
    let directory = tempfile::tempdir().unwrap();
    private_directory(directory.path()).unwrap();
    let path = wide(directory.path().as_os_str()).unwrap();
    let mut owner = null_mut();
    let mut acl = null_mut();
    let mut security = null_mut();
    let error = unsafe {
        GetNamedSecurityInfoW(
            path.as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            null_mut(),
            &mut acl,
            null_mut(),
            &mut security,
        )
    };
    assert_eq!(error, 0);
    let _security = LocalMemory(security);
    assert_eq!(sid_string(owner).unwrap(), current_sid().unwrap());
    assert!(!acl.is_null());
    assert_eq!(unsafe { (*acl).AceCount }, 1);
    let mut entry = null_mut();
    assert_ne!(unsafe { GetAce(acl, 0, &mut entry) }, 0);
    let entry = entry.cast::<ACCESS_ALLOWED_ACE>();
    // ACCESS_ALLOWED_ACE_TYPE is zero. Its sole SID must be the invoking user.
    assert_eq!(unsafe { (*entry).Header.AceType }, 0);
    assert_eq!(
        sid_string(unsafe { std::ptr::addr_of_mut!((*entry).SidStart).cast() }).unwrap(),
        current_sid().unwrap()
    );
    let mut control = 0;
    let mut revision = 0;
    assert_ne!(unsafe { GetSecurityDescriptorControl(security, &mut control, &mut revision) }, 0);
    assert_ne!(control & SE_DACL_PROTECTED, 0);
    // Reopening the same receipt directory must not require elevation or reset its identity.
    private_directory(directory.path()).unwrap();
}
