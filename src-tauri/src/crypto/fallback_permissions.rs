//! Restricts access to credential files used when the OS keychain is unavailable.

use std::io;
use std::path::Path;

#[cfg(unix)]
pub(super) fn restrict_private_file(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = std::fs::metadata(path)?.permissions();
    permissions.set_mode(0o600);
    std::fs::set_permissions(path, permissions)
}

#[cfg(windows)]
pub(super) fn restrict_private_file(path: &Path) -> io::Result<()> {
    use std::{os::windows::ffi::OsStrExt, ptr::null_mut};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::{
        Authorization::{ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1},
        DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
    };

    let path = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let owner_only_dacl = "D:P(A;;FA;;;OW)\0".encode_utf16().collect::<Vec<_>>();
    let mut descriptor = null_mut();

    // OW grants full access to the file owner only; P prevents broader parent
    // directory entries from being inherited by this sensitive file.
    let converted = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            owner_only_dacl.as_ptr(),
            SDDL_REVISION_1,
            &raw mut descriptor,
            null_mut(),
        )
    };
    if converted == 0 {
        return Err(io::Error::last_os_error());
    }

    let secured = unsafe {
        windows_sys::Win32::Security::SetFileSecurityW(
            path.as_ptr(),
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            descriptor,
        )
    };
    let error = (secured == 0).then(io::Error::last_os_error);
    unsafe {
        LocalFree(descriptor);
    }

    error.map_or(Ok(()), Err)
}

#[cfg(not(any(unix, windows)))]
pub(super) fn restrict_private_file(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::restrict_private_file;

    #[cfg(unix)]
    #[test]
    fn unix_private_files_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("private-key");
        std::fs::write(&path, "secret").expect("create private key");

        restrict_private_file(&path).expect("restrict key permissions");

        assert_eq!(
            std::fs::metadata(path)
                .expect("key metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_private_files_have_protected_owner_only_acl() {
        use std::{
            ffi::OsStr,
            mem::{size_of, zeroed},
            os::windows::ffi::OsStrExt,
            ptr::{null_mut, NonNull},
        };
        use windows_sys::Win32::Security::{
            AclSizeInformation, GetAclInformation, GetFileSecurityW, GetSecurityDescriptorControl,
            GetSecurityDescriptorDacl, ACL_SIZE_INFORMATION, DACL_SECURITY_INFORMATION,
            SE_DACL_PROTECTED,
        };

        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("private-key");
        std::fs::write(&path, "secret").expect("create private key");
        restrict_private_file(&path).expect("restrict key ACL");
        let wide_path = OsStr::new(&path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();

        let mut descriptor_size = 0;
        unsafe {
            GetFileSecurityW(
                wide_path.as_ptr(),
                DACL_SECURITY_INFORMATION,
                null_mut(),
                0,
                &raw mut descriptor_size,
            );
        }
        assert!(descriptor_size > 0);
        let mut descriptor = vec![0u8; descriptor_size as usize];
        let read = unsafe {
            GetFileSecurityW(
                wide_path.as_ptr(),
                DACL_SECURITY_INFORMATION,
                descriptor.as_mut_ptr().cast(),
                descriptor_size,
                &raw mut descriptor_size,
            )
        };
        assert_ne!(read, 0);

        let descriptor_ptr = descriptor.as_mut_ptr().cast();
        let mut control = 0;
        let mut revision = 0;
        assert_ne!(
            unsafe {
                GetSecurityDescriptorControl(descriptor_ptr, &raw mut control, &raw mut revision)
            },
            0
        );
        assert_ne!(control & SE_DACL_PROTECTED, 0);

        let mut dacl_present = 0;
        let mut dacl = null_mut();
        let mut dacl_defaulted = 0;
        assert_ne!(
            unsafe {
                GetSecurityDescriptorDacl(
                    descriptor_ptr,
                    &raw mut dacl_present,
                    &raw mut dacl,
                    &raw mut dacl_defaulted,
                )
            },
            0
        );
        assert_eq!(dacl_present, 1);
        let dacl = NonNull::new(dacl).expect("private file DACL");
        let mut acl_size: ACL_SIZE_INFORMATION = unsafe { zeroed() };
        assert_ne!(
            unsafe {
                GetAclInformation(
                    dacl.as_ptr(),
                    (&raw mut acl_size).cast(),
                    u32::try_from(size_of::<ACL_SIZE_INFORMATION>())
                        .expect("ACL size information fits u32"),
                    AclSizeInformation,
                )
            },
            0
        );
        assert_eq!(acl_size.AceCount, 1);
    }
}
