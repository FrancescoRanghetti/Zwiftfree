package ch.zwiftfree.user;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<User, UUID> {

    /** Case-insensitive thanks to the citext column. */
    Optional<User> findByEmail(String email);

    boolean existsByEmail(String email);
}
