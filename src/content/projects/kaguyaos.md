---
title: kaguyaOS
tagline: A hobby operating system for x86_64 UEFI, written in Rust.
language: Rust
tags: [osdev, kernel, smp]
repo: https://github.com/jihoo12/kaguyaos
featured: true
order: 2
---

It boots into userspace on an SMP system and runs a preemptive scheduler. Drivers are written from scratch:

- NVMe storage with a FAT16 filesystem
- xHCI USB keyboard input
- E1000 networking with ARP, ICMP and DNS, enough to `ping google.com`
- virtio-gpu framebuffer with a primitive desktop window
